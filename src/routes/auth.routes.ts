import { Router } from "express";
import { auth, db, getSurveyId, serverTimestamp } from "../lib/firebase";
import { requireAuth } from "../middlewares/requireAuth";
import { usernameToEmail } from "../utils/username";
import { paths } from "../utils/paths";
import {  verifyAdminKey } from "@services/admin-key.service";
import { adminKeyAuth } from "@middlewares/adminKeyAuth";
import { tr } from "zod/v4/locales";
import { requireSurveyAdmin } from "@middlewares/require-admin";

const r = Router();

/**
 * POST /api/auth/login
 * body: { username: string, password: string }
 * returns: { idToken, refreshToken, expiresIn, user: {...claims summary...} }
 *
 * Note: This proxies Google's Identity Toolkit "signInWithPassword".
 * You'll need FIREBASE_WEB_API_KEY in your .env (Firebase console → Project settings).
 */
r.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const email = usernameToEmail(username);
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing FIREBASE_WEB_API_KEY env" });

    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      // pass through clean error
      return res.status(401).json({ error: data.error?.message || "INVALID_CREDENTIALS" });
    }

    const { idToken, refreshToken, expiresIn } = data; // expiresIn in seconds (string)
    // Optionally decode token to show claims summary (do NOT trust it server-side; just for convenience)
    // You can also verify with admin.auth().verifyIdToken if you want.
    let claimsSummary: any = {};
    try {
      const decoded = await auth.verifyIdToken(idToken);
      claimsSummary = {
        uid: decoded.uid,
        role: (decoded as any).role || null,
        surveyId: (decoded as any).surveyId || null,
        contractorId: (decoded as any).contractorId || null,
      };
    } catch {
      // If verification fails (e.g., clock skew), still return tokens; client can use them.
      claimsSummary = {};
    }

    return res.json({
      ok: true,
      idToken,
      refreshToken,
      expiresIn,
      user: claimsSummary,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/auth/logout
 * header: Authorization: Bearer <idToken>
 *
 * NOTE: Firebase "logout" is client-side (delete tokens). This endpoint revokes refresh tokens,
 * effectively logging the user out of ALL sessions/devices. Frontend should also delete its token.
 */
r.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    const uid = req.authUser!.uid;
    await auth.revokeRefreshTokens(uid);
    // Optional: mark in Firestore for audit
    const { surveyId } = req.authUser!.claims;
    const base = `${paths.users(String(surveyId))}/${uid}`;
    await db.doc(base).set({ lastLogoutAt: serverTimestamp() }, { merge: true });

    return res.json({ ok: true, message: "Refresh tokens revoked (logout-all)." });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /admin/surveys/:surveyId/profile
 * Requires admin auth
 * Returns basic admin profile details
 */
r.get(
  "/admin/surveys/:surveyId/profile",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      console.log("Fetching admin profile");
      const { surveyId } = req.params as any;
      const uid = req.authUser!.uid; // admin uid from token
      console.log("Fetching admin profile for uid:", uid);
      // Admin profile lives under: surveys/{surveyId}/users/{uid}
      const ref = db.doc(`surveys/${surveyId}/users/${uid}`);
      const snap = await ref.get();

      if (!snap.exists) {
        return res.status(404).json({ error: "Admin profile not found" });
      }

      const data = snap.data() || {};

      return res.json({
        ok: true,
        profile: {
          displayName: data.displayName || "",
          username: data.username || "",
          phone: data.phone || "",
          title: data.title || "",
          email: data.email || "",
        },
      });
    } catch (e: any) {
      console.error("profile error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);


/**
 * PATCH /api/auth/profile
 * header: Authorization: Bearer <idToken>
 * body: { displayName?, password?, username? }
 *
 * - displayName: updates Firebase user displayName
 * - password: updates Firebase password (min 6)
 * - username: updates your synthetic email (username@yourapp.local)
 *   and the Firestore user doc. Claims remain unchanged.
 */
r.patch("/auth/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.authUser!.uid;
    const { displayName, password, username } = req.body || {};
    const updates: any = {};
    const toSetFirestore: any = { updatedAt: serverTimestamp() };

    // Display name
    if (typeof displayName === "string" && displayName.trim()) {
      updates.displayName = displayName.trim();
      toSetFirestore.displayName = updates.displayName;
    }

    // Password
    if (typeof password === "string") {
      if (password.length < 6) {
        return res.status(400).json({ error: "password must be at least 6 characters" });
      }
      updates.password = password;
    }

    // Username (email mapping)
    let newEmail: string | undefined;
    if (typeof username === "string" && username.trim()) {
      newEmail = usernameToEmail(username);
      updates.email = newEmail;
      updates.emailVerified = true;
      toSetFirestore.username = username.trim();
      toSetFirestore.email = newEmail;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No changes provided" });
    }

    // Apply to Firebase Auth
    const userRecord = await auth.updateUser(uid, updates);

    // Mirror to Firestore user doc (survey or contractor scope)
    const { surveyId } = req.authUser!.claims;
    if (!surveyId && req.authUser!.claims.role !== "superadmin") {
      // Shouldn't happen if your tokens are set correctly
      return res.status(400).json({ error: "Missing surveyId in token" });
    }
    const base =`${paths.users(String(surveyId))}/${uid}`;
    await db.doc(base).set(toSetFirestore, { merge: true });

    return res.json({
      ok: true,
      uid: userRecord.uid,
      displayName: userRecord.displayName,
      email: userRecord.email,
      updated: Object.keys(updates),
    });
  } catch (e: any) {
    // Email already in use → Firebase throws; surface a clean message
    if (String(e?.errorInfo?.code || "").includes("email-already-exists")) {
      return res.status(409).json({ error: "USERNAME_TAKEN" });
    }
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /auth/password
// Headers: Authorization: Bearer <idToken>
// Body: { newPassword: string }  // >= 6 chars
/**
 * PATCH /admin/surveys/:surveyId/profile
 * Header: Authorization: Bearer <idToken>
 * Body: {
 *   displayName?: string;
 *   username?: string;   // logical username (will be converted to email)
 *   phone?: string;
 *   title?: string;      // e.g. "מנהל מדידות"
 * }
 */
r.patch(
  "/admin/surveys/:surveyId/profile",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;

      // make sure admin belongs to this survey
      const claims = req.authUser!.claims || {};
      if (claims.role !== "survey_admin" && claims.role !== "superadmin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!claims.surveyId && claims.role !== "superadmin") {
        return res.status(400).json({ error: "Missing surveyId in token" });
      }
      if (claims.role !== "superadmin" && String(claims.surveyId) !== String(surveyId)) {
        return res.status(403).json({ error: "Cross-survey update not allowed" });
      }

      const uid = req.authUser!.uid;
      const { displayName, username, phone, title } = req.body || {};

      const updatesAuth: any = {};
      const updatesFirestore: any = { updatedAt: serverTimestamp() };

      // 🔹 displayName → Firebase + Firestore
      if (typeof displayName === "string" && displayName.trim()) {
        updatesAuth.displayName = displayName.trim();
        updatesFirestore.displayName = updatesAuth.displayName;
      }

      // 🔹 username → we convert to synthetic email + store username
      if (typeof username === "string" && username.trim()) {
        const cleanUser = username.trim();
        const email = usernameToEmail(cleanUser); // e.g. username@yourapp.local
        updatesAuth.email = email;
        updatesAuth.emailVerified = true;
        updatesFirestore.username = cleanUser;
        updatesFirestore.email = email;
      }

      // 🔹 extra profile fields only in Firestore
      if (typeof phone === "string") {
        updatesFirestore.phone = phone.trim();
      }
      if (typeof title === "string") {
        updatesFirestore.title = title.trim();
      }

      if (
        Object.keys(updatesAuth).length === 0 &&
        Object.keys(updatesFirestore).length === 1 && // only updatedAt
        !("phone" in updatesFirestore) &&
        !("title" in updatesFirestore)
      ) {
        return res.status(400).json({ error: "No changes provided" });
      }

      // 1) Update Firebase Auth (name/email)
      if (Object.keys(updatesAuth).length > 0) {
        await auth.updateUser(uid, updatesAuth);
      }

      // 2) Update admin Firestore doc
      //   You already use this path in /auth/profile:
      const userDocPath = `${paths.users(String(surveyId))}/${uid}`;
      await db.doc(userDocPath).set(updatesFirestore, { merge: true });

      return res.json({
        ok: true,
        uid,
        updatedAuthFields: Object.keys(updatesAuth),
        profile: updatesFirestore,
      });
    } catch (e: any) {
      // e.g. email already exists for another user
      const code = String(e?.errorInfo?.code || "");
      if (code.includes("email-already-exists")) {
        return res.status(409).json({ error: "USERNAME_TAKEN" });
      }
      console.error("Admin profile update failed:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

r.patch("/auth/password", requireAuth, async (req, res) => {
  try {
    const uid = req.authUser!.uid;
    const { newPassword } = req.body || {};

    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "newPassword must be at least 6 characters" });
    }

    // Update password in Firebase Authentication (securely stored by Firebase)
    await auth.updateUser(uid, { password: newPassword });

    // (Optional) Invalidate existing sessions/tokens
    await auth.revokeRefreshTokens(uid);

    // (Optional) mirror a timestamp to your user doc if you keep one
    const { surveyId } = req.authUser!.claims || {};
    if (surveyId) {
      await db
        .doc(`${paths.users(String(surveyId))}/${uid}`)
        .set({ passwordUpdatedAt: serverTimestamp() }, { merge: true });
    }

    return res.json({ ok: true, message: "Password updated. Please sign in again." });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});



  r.get("/me", async (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    console.log("Authorization token:", token);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const decoded = await auth.verifyIdToken(token, true);
    console.log("Decoded token:", decoded);
  res.json({ uid: decoded.uid, email: decoded.email  , surveyId: (decoded as any).surveyId || null, role: (decoded as any).role || null  });
});

export default r;

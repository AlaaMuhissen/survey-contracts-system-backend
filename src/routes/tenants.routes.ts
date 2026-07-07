import { Router } from "express";
import { db, auth, serverTimestamp } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth } from "../middlewares/requireAuth";
import { requireTenant } from "../middlewares/requireTenant";
import { requireSurveyAdmin } from "../middlewares/require-admin";
import { usernameToEmail } from "../utils/username";
import { adminKeyAuth } from "@middlewares/adminKeyAuth";

const r = Router();

/**
 * Create a survey company and a survey admin (username/password)
 * POST /api/surveys
 * body: { name: string, admin: { username: string, password: string } }
 * roles: superadmin only
 */
r.post("/surveys", adminKeyAuth, async (req, res) => {
  try {

    console.log("Auth user:", req.authUser);
    const role = req.authUser?.claims.role || "superadmin";
    if (role !== "superadmin") return res.status(403).json({ error: "Superadmin only" });

    const { name, admin: adminInput } = req.body || {};
    if (!name || !adminInput?.username || !adminInput?.password) {
      return res.status(400).json({ error: "name, admin.username, admin.password required" });
    }

    const surveyRef = db.collection("surveys").doc();
    const surveyId = surveyRef.id;

    // Create survey admin account (username -> internal email)
    const email = usernameToEmail(adminInput.username);
    const user = await auth.createUser({
      email, password: adminInput.password, displayName: `Admin ${name}`, emailVerified: true
    });
    await auth.setCustomUserClaims(user.uid, { surveyId, role: "survey_admin" });

    await surveyRef.set({ name, nameLower: name.toLowerCase(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.doc(`surveys/${surveyId}/users/${user.uid}`).set({
      username: adminInput.username, email, role: "survey_admin", createdAt: serverTimestamp()
    }, { merge: true });

    res.json({ ok: true, surveyId, adminUid: user.uid, adminEmail: email });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * (Optional) invite survey staff (survey_admin/survey_viewer)
 * POST /api/surveys/:surveyId/invites
 * body: { username?: string, email?: string, role: 'survey_admin'|'survey_viewer' }
 */
r.post("/surveys/:surveyId/invites", requireAuth, requireTenant, requireSurveyAdmin, async (req, res) => {
  try {
    const { surveyId } = req.params as any;
    const { email, username, role } = req.body || {};
    if (!role || (!email && !username)) return res.status(400).json({ error: "role and email|username required" });

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.doc(`surveys/${surveyId}/invites/${token}`).set({
      email: email || null,
      username: username || null,
      role,
      token,
      createdAt: FieldValue.serverTimestamp(),
      used: false,
    }, { merge: true });

    res.json({ ok: true, token });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Accept any invite (survey or contractor)
 * POST /api/invites/accept
 * body: { token: string }
 * role: signed-in user
 */
r.post("/invites/accept", requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });

    // find invite across surveys & contractors
    const snap = await db.collectionGroup("invites").where("token", "==", token).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Invite not found" });
    const inviteDoc = snap.docs[0];
    const data = inviteDoc.data() as any;

    // detect surveyId & contractorId from path
    const invitesColl = inviteDoc.ref.parent;               // invites
    const parent = invitesColl.parent!;                     // surveys/{sId} OR .../companies/{cId}
    const maybeCompanies = parent.parent;                   // surveys/{sId}/companies ?
    let surveyId = "";

    if (maybeCompanies && maybeCompanies.id === "companies") {          // company id
      surveyId = parent.parent!.id;           // survey id
    } else {
      surveyId = parent.id;                   // survey-level invite
    }

    const claims: any = { surveyId, role: data.role };
  

    await auth.setCustomUserClaims(req.authUser!.uid, claims);

    const baseDocPath = `surveys/${surveyId}/users/${req.authUser!.uid}`;

    await db.doc(baseDocPath).set({
      email: req.authUser!.email ?? null,
      role: data.role,
      joinedAt: serverTimestamp(),
    }, { merge: true });

    await inviteDoc.ref.update({ used: true, usedAt: serverTimestamp(), usedBy: req.authUser!.uid });

    res.json({ ok: true, surveyId: surveyId || null, role: data.role });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default r;

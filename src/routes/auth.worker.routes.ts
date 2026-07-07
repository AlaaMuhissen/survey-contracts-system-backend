import { Router } from "express";
import { db, serverTimestamp } from "../lib/firebase";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSurveyAdmin } from "../middlewares/require-admin";
import { paths } from "../utils/paths";
import { requireWorker } from "@middlewares/requireWorker";

async function findWorkerDocRef(surveyId: string, idOrWorkerId: string) {
  const col = db.collection(paths.workers(surveyId));
  // Try direct doc id first
  const byId = await col.doc(idOrWorkerId).get();
  if (byId.exists) return col.doc(idOrWorkerId);

  // Fallback: search by workerId field
  const snap = await col.where("workerId", "==", idOrWorkerId).limit(1).get();
  if (!snap.empty) return snap.docs[0].ref;

  return null;
}
function toIso(v: any): string | null {
  try {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    const d = new Date(v);
    return isNaN(+d) ? null : d.toISOString();
  } catch {
    return null;
  }
}

const r = Router();
/**
 * GET /admin/surveys/:surveyId/workers
 * Query params:
 *  - limit?: number (default 25, max 100)
 *  - cursor?: string   (last workerId from previous page)
 *  - q?: string        (prefix search on workerId) 
 */
r.get("/admin/surveys/:surveyId/workers",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      let { limit, cursor, q } = (req.query || {}) as {
        limit?: string;
        cursor?: string;
        q?: string;
      };

      const lim = Math.min(Math.max(parseInt(limit || "25", 10) || 25, 1), 100);
      const qPrefix = (q || "").trim();

      let ref = db.collection(paths.workers(surveyId)) as FirebaseFirestore.Query;

      // We order by workerId to support both pagination and prefix search
      ref = ref.orderBy("workerId");

      // Prefix search (Firestore-friendly)
      if (qPrefix) {
        const end = qPrefix + "\uf8ff";
        ref = ref.startAt(qPrefix).endAt(end);
      }

      // Cursor uses last workerId from previous page
      if (cursor) {
        ref = ref.startAfter(cursor);
      }

      // Fetch +1 to determine if there’s next page
      const snap = await ref.limit(lim + 1).get();

      const items: Array<{
        id: string;
        workerId: string;
        active?: boolean;
        displayName ?: string;
        createdAtISO?: string | null;
        lastLoginAtISO?: string | null;
      }> = [];

      snap.docs.slice(0, lim).forEach((doc) => {
        const d = doc.data() as any;
        items.push({
          id: doc.id,
          workerId: d.workerId,
          active: d.active !== false,
          displayName: d.displayName,
          createdAtISO: toIso(d.createdAt),
          lastLoginAtISO: toIso(d.lastLoginAt),
          // DO NOT include passwordHash or secrets
        });
      });

      // nextCursor is the last workerId in the page (not doc.id),
      // because we used orderBy("workerId")
      let nextCursor: string | null = null;
      if (snap.docs.length > lim) {
        const lastVisible = snap.docs[lim - 1];
        const lastWorkerId = (lastVisible?.data() as any)?.workerId;
        if (lastWorkerId) nextCursor = String(lastWorkerId);
      }

      res.json({ ok: true, items, nextCursor });
    } catch (e: any) {
      console.error("GET workers failed:", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /admin/surveys/:surveyId/workers/:idOrWorkerId
 * - :idOrWorkerId can be the Firestore doc id OR the workerId field (9-digit ID)
 */
r.get("/admin/surveys/:surveyId/workers/:idOrWorkerId",
  requireWorker,
  async (req, res) => {
    try {
      const { surveyId, idOrWorkerId } = req.params as any;

      if (!surveyId || !idOrWorkerId) {
        return res.status(400).json({ error: "Missing surveyId or worker identifier" });
      }

      const col = db.collection(paths.workers(surveyId));

      // 1) Try as document id
      let snap = await col.doc(idOrWorkerId).get();

      // 2) If not found, try as workerId field
      if (!snap.exists) {
        const qSnap = await col.where("workerId", "==", idOrWorkerId).limit(1).get();
        if (qSnap.empty) {
          return res.status(404).json({ error: "Worker not found" });
        }
        snap = qSnap.docs[0];
      }

      const d = snap.data() as any;
      const worker = {
        id: snap.id,
        workerId: d.workerId,
        displayName: d.displayName || "",
        active: d.active !== false,
        createdAtISO: d.createdAt ? toIso(d.createdAt) : null,
        lastLoginAtISO: d.lastLoginAt ? toIso(d.lastLoginAt) : null,
      };

      return res.json({ ok: true, worker });
    } catch (e: any) {
      console.error("GET single worker failed:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * PATCH /surveys/:surveyId/workers/:idOrWorkerId/displayName
 * Body: { displayName: string }
 *
 * - Only admins (requireSurveyAdmin) can call this
 * - idOrWorkerId can be either:
 *   - Firestore doc ID, or
 *   - workerId field
 */
r.patch(
  "/surveys/:surveyId/workers/:idOrWorkerId/displayName",
   requireWorker,
  async (req, res) => {
    try {
      const { surveyId, idOrWorkerId } = req.params as any;
      const { displayName } = req.body || {};

      if (typeof displayName !== "string" || !displayName.trim()) {
        return res.status(400).json({ error: "displayName is required" });
      }

      const trimmedName = displayName.trim();

      const col = db.collection(paths.workers(surveyId));

      // 1) Try by document ID
      let docRef = col.doc(idOrWorkerId);
      let snap = await docRef.get();

      // 2) If not found, try by workerId field
      if (!snap.exists) {
        const q = await col.where("workerId", "==", idOrWorkerId).limit(1).get();
        if (q.empty) {
          return res.status(404).json({ error: "Worker not found" });
        }
        docRef = q.docs[0].ref;
        snap = q.docs[0];
      }

      await docRef.set(
        {
          displayName: trimmedName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const data = snap.data() as any;

      return res.json({
        ok: true,
        id: docRef.id,
        workerId: data.workerId,
        displayName: trimmedName,
      });
    } catch (e: any) {
      console.error("PATCH worker displayName failed:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * ADMIN ONLY – Register worker under a specific survey
 * POST /api/surveys/:surveyId/workers/register
 * body: { workerId: string, password: string}
 */
r.post("/surveys/:surveyId/workers/register",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { workerId } = req.body;
      const displayName = req.body.displayName || "";
      const disabled = false;
      const password = "12345678";

      // 1️⃣ Validate presence
      if (!workerId) {
        return res.status(400).json({ error: "Missing required field: workerId" });
      }

      // 2️⃣ Validate format: must be 9 digits
      if (!/^\d{9}$/.test(workerId)) {
        return res.status(400).json({ error: "workerId must be exactly 9 digits" });
      }

      // 3️⃣ Check uniqueness
      const existing = await db
        .collection(paths.workers(surveyId))
        .where("workerId", "==", workerId)
        .limit(1)
        .get();

      if (!existing.empty) {
        return res.status(409).json({ error: "Worker with this ID already exists" });
      }

      // 4️⃣ Hash and save
      const hash = await bcrypt.hash(password, 10);

      const ref = db.collection(paths.workers(surveyId)).doc();
      await ref.set(
        {
          workerId,
          displayName,
          disabled,
          passwordHash: hash,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      res.json({ ok: true, workerId });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);


/**
 * POST /api/surveys/workers/login
 * body: { workerId: string, password: string }
 *
 * - Looks up the worker by workerId in ALL surveys
 *   (surveys/{surveyId}/workers/*)
 * - On success returns JWT + surveyId
 */
r.post("/surveys/workers/login", async (req, res) => {
  try {
    const { workerId, password } = req.body || {};

    if (!workerId || !password) {
      return res
        .status(400)
        .json({ error: "Missing workerId or password" });
    }

    // 1) Load all surveys
    const surveysSnap = await db.collection("surveys").get();

    let foundDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let foundSurveyId: string | null = null;

    // 2) For each survey, look for this workerId in its workers subcollection
    for (const surveyDoc of surveysSnap.docs) {
      const sId = surveyDoc.id;

      const workersSnap = await surveyDoc.ref
        .collection("workers")
        .where("workerId", "==", workerId)
        .limit(1)
        .get();

      if (!workersSnap.empty) {
        foundDoc = workersSnap.docs[0];
        foundSurveyId = sId;
        break;
      }
    }

    if (!foundDoc || !foundSurveyId) {
      return res.status(404).json({ error: "Worker not found" });
    }

    const worker = foundDoc.data() as {
      passwordHash?: string;
      displayName?: string;
    };

    if (!worker.passwordHash) {
      return res.status(400).json({ error: "Worker password not set" });
    }

    // 3) Check password
    const match = await bcrypt.compare(password, worker.passwordHash);
    console.log("Password match:", match);  
    console.log("Worker data:", password, worker.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const surveyId = foundSurveyId;

    // 4) Build JWT
    const token = jwt.sign(
      {
        workerId,
        role: "worker",
        surveyId,
      },
      process.env.JWT_INVITE_SECRET!,
      { expiresIn: "360d" }
    );

    return res.json({
      ok: true,
      idToken: token,
      workerId,
      surveyId,
      role: "worker",
      displayName: worker.displayName || null,
 
    });
  } catch (e: any) {
    console.error("workers login error:", e);
    return res.status(500).json({ error: e.message });
  }
});


/**
 * POST /surveys/:surveyId/workers/change-password
 * Body: { currentPassword: string, newPassword: string }
 * Auth: Bearer <worker JWT>
 */
r.post("/surveys/:surveyId/workers/change-password",
  requireWorker,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { currentPassword, newPassword } = req.body || {};

      // Auth guard: token must be worker & same survey
      const auth = req.authUser;
      if (!auth?.claims?.role || auth.claims.role !== "worker") {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (auth.claims.surveyId !== surveyId) {
        return res.status(403).json({ error: "Cross-survey access denied" });
      }
      const workerId = auth.uid;

      // Validate payload
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Missing fields" });
      }
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 chars" });
      }
      // (Optional) quick strength rule
      const hasNum = /\d/.test(newPassword);
      const hasLetter = /[A-Za-z]/.test(newPassword);
      if (!hasNum || !hasLetter) {
        return res.status(400).json({ error: "Password must contain letters and numbers" });
      }

      // Find the worker doc (you currently store workerId as a field, not doc id)
      const snap = await db
        .collection(paths.workers(surveyId))
        .where("workerId", "==", workerId)
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(404).json({ error: "Worker not found" });
      }

      const doc = snap.docs[0];
      const data = doc.data() as { passwordHash?: string };

      if (!data.passwordHash) {
        return res.status(400).json({ error: "Worker password not set" });
      }

      // Verify current password
      const ok = await bcrypt.compare(currentPassword, data.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash and save the new one
      const newHash = await bcrypt.hash(newPassword, 10);
      await doc.ref.update({
        passwordHash: newHash,
        passwordChangedAt: serverTimestamp(),
      });

      // (Optional) issue a fresh token so client can keep working
      const token = jwt.sign(
        {
          workerId,
          surveyId,
          role: "worker",
        },
        process.env.JWT_INVITE_SECRET!,
        { expiresIn: "360d" }
      );

      return res.json({
        ok: true,
        message: "Password updated",
        idToken: token, // client can replace its worker token with this
      });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// DELETE /surveys/:surveyId/workers/:idOrWorkerId
// If :idOrWorkerId is 9 digits → delete by workerId field.
// Otherwise → treat it as the Firestore document id.
r.delete( "/surveys/:surveyId/workers/:idOrWorkerId",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, idOrWorkerId } = req.params as any;
    
      // Case A: delete by document id (fast path)
      if (!/^\d{9}$/.test(idOrWorkerId)) {
        const docRef = db.collection(paths.workers(surveyId)).doc(idOrWorkerId);
        const snap = await docRef.get();
        if (!snap.exists) {
          return res.status(404).json({ error: "Worker doc not found" });
        }
        await docRef.delete();
        return res.json({ ok: true, by: "docId", id: idOrWorkerId });
      }

      // Case B: delete by 9-digit workerId value
      const q = await db
        .collection(paths.workers(surveyId))
        .where("workerId", "==", idOrWorkerId)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(404).json({ error: "Worker with this workerId not found" });
      }

      const doc = q.docs[0];
      await doc.ref.delete();
      res.json({ ok: true, by: "workerId", workerId: idOrWorkerId, docId: doc.id });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

// PATCH /surveys/:surveyId/workers/:idOrWorkerId/disable
// body: { disabled: boolean }
r.patch("/surveys/:surveyId/workers/:idOrWorkerId/disable",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      console.log("Disable worker called");
      const { surveyId, idOrWorkerId } = req.params as any;
      const { disabled } = req.body ?? {};
      if (typeof disabled !== "boolean") {
        return res.status(400).json({ error: "disabled boolean required" });
      }

      const resolveDoc = async () => {
        if (!/^\d{9}$/.test(idOrWorkerId)) {
          return db.collection(paths.workers(surveyId)).doc(idOrWorkerId);
        }
        const q = await db
          .collection(paths.workers(surveyId))
          .where("workerId", "==", idOrWorkerId)
          .limit(1)
          .get();
        console.log("disable worker query result:", q);
        if (q.empty) return null;
        return q.docs[0].ref;
      };

      const ref = await resolveDoc();

      if (!ref) return res.status(404).json({ error: "Worker not found" });

      await ref.set({ disabled, disabledAt: serverTimestamp() }, { merge: true });
      res.json({ ok: true, disabled });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Admin reset worker password to default "12345678"
 * POST /surveys/:surveyId/workers/:id/reset-password
 * Auth: Bearer <adminToken>
 */
r.post( "/surveys/:surveyId/workers/:id/reset-password",
  requireAuth,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, id } = req.params as any;

      if (!surveyId || !id) {
        return res.status(400).json({ error: "Missing surveyId or id" });
      }

      const ref = await findWorkerDocRef(surveyId, id);
      if (!ref) {
        return res.status(404).json({ error: "Worker not found" });
      }

      // default password
      const DEFAULT_PW = "12345678";
      const passwordHash = await bcrypt.hash(DEFAULT_PW, 10);

      await ref.set(
        {
          passwordHash,
          // Optional but useful:
          mustChangePassword: true,               // force change on next login
          passwordUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      res.json({ ok: true, resetTo: DEFAULT_PW });
    } catch (e: any) {
      console.error("reset-password failed:", e);
      res.status(500).json({ error: e.message || "Internal error" });
    }
  }
);

export default r;
import { Router } from "express";
import { z } from "zod";
import { db, serverTimestamp, auth } from "../lib/firebase";
import { requireAuth } from "../middlewares/requireAuth";
import { requireTenant } from "../middlewares/requireTenant";
import { requireSurveyAdmin, requireContractorAdmin } from "../middlewares/require-admin";
import { paths } from "../utils/paths";
import { usernameToEmail } from "../utils/username";
import { buildContractPdfPath, uploadBase64Pdf, getFileUrl } from "../lib/cloudinary";



const RotateSchema = z.object({
  confirmKey: z.string().min(1),
  newKey: z
    .string()
    .optional()
    .refine(v => !v || v.length >= 16 || v.trim().split(/\s+/).length >= 4,
      "Key too weak: use ≥16 chars or a 4+ word passphrase"),
  graceHours: z.number().int().min(0).max(72).optional(),
});


const r = Router();

/**
 * Create contractor (company) under a survey
 * POST /api/surveys/:surveyId/companies
 * body: { name: string }
 * roles: survey_admin, superadmin
 */
r.post("/surveys/:surveyId/companies", requireAuth, requireTenant, requireSurveyAdmin, async (req, res) => {
  try {
    const { surveyId } = req.params as any;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });

    const ref = db.collection(paths.companies(surveyId)).doc();
    await ref.set({ name, nameLower: String(name).toLowerCase(), createdAt: serverTimestamp() }, { merge: true });
    res.json({ ok: true, companyId: ref.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

  r.get(
    "/surveys/:surveyId/workLogs",
    requireAuth,
    requireTenant,
    async (req, res) => {
      try {
        const { surveyId } = req.params as any;
        const { limit = "25", cursor, q } = req.query as {
          limit?: string;
          cursor?: string;
          q?: string;
        };

        const role = req.authUser?.claims.role;
        const requesterId = req.authUser?.uid || null;

        // Base collection for this survey
        let qry: FirebaseFirestore.Query = db
          .collection(paths.workLogs(surveyId)) // -> "surveys/{surveyId}/workLogs"
          .orderBy("createdAt", "desc");

        // Optional prefix search by number
        if (q && String(q).trim()) {
          const qq = String(q).trim();
          qry = qry.where("number", ">=", qq).where("number", "<=", qq + "\uf8ff");
        }

        // Workers only see their own entries
        if (role === "worker" && requesterId) {
          qry = qry.where("by", "==", requesterId);
        }

        // Cursor: pass ms since epoch; we startAfter(Date)
        if (cursor) {
          const ms = Number(cursor);
          if (Number.isFinite(ms)) {
            qry = qry.startAfter(new Date(ms));
          }
        }

        const snap = await qry.limit(Number(limit) || 25).get();

        const items = snap.docs
          .map(d => {
            const data = d.data() as any;
            const ms = data.createdAt?.toMillis?.() ?? null;
            return {
              id: d.id,
              ...data,
              createdAtMs: ms,
              createdAtISO: ms ? new Date(ms).toISOString() : null,
            };
          })
          // Exclude transient "pending" placeholders (mid-upload, no
          // fileUrl yet). Legacy docs with no `status` field are unaffected.
          .filter((item: any) => item.status !== "pending");

        const last = items[items.length - 1];
        const nextCursor = last?.createdAtMs ? Number(last.createdAtMs) : null;

        res.json({ items, nextCursor });
      } catch (e) {
        console.error("survey worklogs list error:", e);
        res.status(500).json({ error: "Internal error" });
      }
    }
  );


/**
 * Create a contractor user (username/password) and set claims
 * POST /api/surveys/:surveyId/companies/:companyId/users
 * body: { username: string, password: string, role: 'contractor_admin'|'worker'|'viewer' }
 * roles: survey_admin, superadmin
 */
r.post("/surveys/:surveyId/companies/:companyId/users", requireAuth, requireTenant, requireSurveyAdmin, async (req, res) => {
  try {
    const { surveyId, companyId } = req.params as any;
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: "username, password, role required" });
    }
    const email = usernameToEmail(username);
    const user = await auth.createUser({ email, password, displayName: username, emailVerified: true });
    await auth.setCustomUserClaims(user.uid, { surveyId, contractorId: companyId, role });

    await db.doc(`${paths.companyUsers(surveyId, companyId)}/${user.uid}`).set({
      username, email, role, createdAt: serverTimestamp()
    }, { merge: true });

    res.json({ ok: true, uid: user.uid, email });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Upload a contract PDF to Cloudinary and store its path
 * POST /api/surveys/:surveyId/companies/:companyId/contracts/:contractId/upload
 * body: { fileBase64: string, contentType?: string }
 * roles: contractor_admin, survey_admin, superadmin
 */
r.post("/surveys/:surveyId/companies/:companyId/contracts/:contractId/upload",
  requireAuth, requireTenant, requireContractorAdmin,
  async (req, res) => {
    try {
      const { surveyId, companyId, contractId } = req.params as any;
      const { fileBase64, contentType = "application/pdf" } = req.body || {};
      if (!fileBase64) return res.status(400).json({ error: "fileBase64 required" });

      const objectPath = buildContractPdfPath(surveyId, companyId, contractId);
      const { public_id } = await uploadBase64Pdf(objectPath, fileBase64, contentType);

      // Field name kept as `supabasePath` for compatibility with existing
      // Firestore docs / any frontend reading this field — it now holds the
      // Cloudinary public_id instead of a Supabase object path.
      await db.doc(`${paths.companyContracts(surveyId, companyId)}/${contractId}`).set({
        supabasePath: public_id, updatedAt: serverTimestamp()
      }, { merge: true });

      res.json({ ok: true, supabasePath: public_id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Get signed URL for a contract PDF
 * GET /api/surveys/:surveyId/companies/:companyId/contracts/:contractId/signed-url
 */
r.get("/surveys/:surveyId/companies/:companyId/contracts/:contractId/signed-url",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId, companyId, contractId } = req.params as any;
      const doc = await db.doc(`${paths.companyContracts(surveyId, companyId)}/${contractId}`).get();
      if (!doc.exists) return res.status(404).json({ error: "contract not found" });
      const { supabasePath } = doc.data() as any;
      if (!supabasePath) return res.status(400).json({ error: "no supabasePath" });

      const url = getFileUrl(supabasePath, "raw");
      res.json({ ok: true, url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default r;
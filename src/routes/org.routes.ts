import { Router } from "express";
import { db, serverTimestamp } from "../lib/firebase";
import { requireAuth } from "../middlewares/requireAuth";
import { requireTenant } from "../middlewares/requireTenant";
import { requireSurveyAdmin, requireContractorAdmin } from "../middlewares/require-admin";
import { paths } from "../utils/paths";
import { supabase, SUPABASE_BUCKET } from "@lib/supabase";
import multer from "multer";

const r = Router();
const upload = multer({ storage: multer.memoryStorage() });
/* ===========================
 * Companies (contractors)
 * =========================== */

/**
 * Create contractor company (survey admin only)
 * POST /api/surveys/:surveyId/companies
 * body: { name: string }
 */
r.post("/surveys/:surveyId/companies",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { name, companyNumber, contactPerson, contactEmail, contactPhone } = req.body || {};

      if (!name) return res.status(400).json({ error: "name required" });

      const ref = db.collection(paths.companies(surveyId)).doc();
      await ref.set({
        name,
        companyNumber,
        contactPerson,
        contactEmail,
        contactPhone,
        nameLower: String(name).toLowerCase(),
        createdAt: serverTimestamp(),
      }, { merge: true });

      res.json({ ok: true, companyId: ref.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

r.put(
  "/surveys/:surveyId/companies/:companyId",
  requireAuth,
  requireTenant,
  requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, companyId } = req.params as any;

      const {
        name,
        companyNumber,
        contactPerson,
        contactEmail,
        contactPhone,
      } = req.body || {};

      if (!companyId) return res.status(400).json({ error: "companyId required" });

      const ref = db.doc(`${paths.companies(surveyId)}/${companyId}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "not found" });

      
      const patch: any = {
        updatedAt: serverTimestamp(),
      };

      if (typeof name === "string") {
        const trimmed = name.trim();
        if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
        patch.name = trimmed;
        patch.nameLower = trimmed.toLowerCase();
      }

      if (typeof companyNumber !== "undefined") patch.companyNumber = companyNumber;
      if (typeof contactPerson !== "undefined") patch.contactPerson = contactPerson;
      if (typeof contactEmail !== "undefined") patch.contactEmail = contactEmail;
      if (typeof contactPhone !== "undefined") patch.contactPhone = contactPhone;

      // If nothing to update except updatedAt
      if (Object.keys(patch).length === 1) {
        return res.status(400).json({ error: "no fields to update" });
      }

      await ref.set(patch, { merge: true });

      res.json({ ok: true, companyId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);


/**
 * List contractors in a survey
 * GET /api/surveys/:surveyId/companies
 */
r.get("/surveys/:surveyId/companies",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const snap = await db.collection(paths.companies(surveyId))
        .orderBy("nameLower", "asc")
        .get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Get a single contractor
 * GET /api/surveys/:surveyId/companies/:companyId
 */
r.get("/surveys/:surveyId/companies/:companyId",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId, companyId } = req.params as any;
      const doc = await db.doc(paths.company(surveyId, companyId)).get();
      if (!doc.exists) return res.status(404).json({ error: "not found" });
      res.json({ id: doc.id, ...doc.data() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Update contractor (survey admin only)
 * PATCH /api/surveys/:surveyId/companies/:companyId
 * body: { name?: string }
 */
r.patch("/surveys/:surveyId/companies/:companyId",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, companyId } = req.params as any;
      const { name } = req.body || {};
      const patch: any = { updatedAt: serverTimestamp() };
      if (typeof name === "string" && name.trim()) {
        patch.name = name.trim();
        patch.nameLower = name.trim().toLowerCase();
      }
      await db.doc(paths.company(surveyId, companyId)).set(patch, { merge: true });
      const after = await db.doc(paths.company(surveyId, companyId)).get();
      res.json({ id: after.id, ...after.data() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Delete contractor (survey admin only)
 * DELETE /api/surveys/:surveyId/companies/:companyId
 * NOTE: this deletes only the company doc (not subcollections).
 */
r.delete("/surveys/:surveyId/companies/:companyId",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, companyId } = req.params as any;
      await db.doc(paths.company(surveyId, companyId)).delete();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ===========================
 * Private clients (worker's "private service" mode)
 * price is admin-only — never returned by the public/worker-facing endpoint
 * =========================== */

/**
 * Create private client (survey admin only)
 * POST /api/surveys/:surveyId/private-clients
 * body: { name: string, price?: number, address?: string, phone?: string, email?: string }
 */
r.post("/surveys/:surveyId/private-clients",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { name, price, address, phone, email } = req.body || {};

      if (!name) return res.status(400).json({ error: "name required" });
      if (price !== undefined && typeof price !== "number") {
        return res.status(400).json({ error: "price must be a number" });
      }

      const ref = db.collection(paths.privateClients(surveyId)).doc();
      const payload: any = {
        name,
        nameLower: String(name).toLowerCase(),
        active: true,
        createdAt: serverTimestamp(),
      };
      if (typeof price === "number") payload.price = price;
      if (typeof address === "string" && address.trim()) payload.address = address.trim();
      if (typeof phone === "string" && phone.trim()) payload.phone = phone.trim();
      if (typeof email === "string" && email.trim()) payload.email = email.trim();

      await ref.set(payload, { merge: true });
      res.json({ ok: true, privateClientId: ref.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * List private clients in a survey (includes price — admin only)
 * GET /api/surveys/:surveyId/private-clients
 */
r.get("/surveys/:surveyId/private-clients",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const snap = await db.collection(paths.privateClients(surveyId))
        .orderBy("nameLower", "asc")
        .get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Update private client (survey admin only)
 * PUT /api/surveys/:surveyId/private-clients/:privateClientId
 * body: { name?, price?, active?, address?, phone?, email? }
 */
r.put(
  "/surveys/:surveyId/private-clients/:privateClientId",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, privateClientId } = req.params as any;
      const { name, price, active, address, phone, email } = req.body || {};

      if (!privateClientId) return res.status(400).json({ error: "privateClientId required" });
      if (price !== undefined && price !== null && typeof price !== "number") {
        return res.status(400).json({ error: "price must be a number" });
      }

      const ref = db.doc(paths.privateClient(surveyId, privateClientId));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "not found" });

      const patch: any = { updatedAt: serverTimestamp() };

      if (typeof name === "string") {
        const trimmed = name.trim();
        if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
        patch.name = trimmed;
        patch.nameLower = trimmed.toLowerCase();
      }
      if (typeof price === "number") patch.price = price;
      if (typeof active === "boolean") patch.active = active;
      // address/phone/email are optional and clearable — an explicit empty
      // string means "remove this field", not "leave unchanged"
      if (typeof address === "string") patch.address = address.trim();
      if (typeof phone === "string") patch.phone = phone.trim();
      if (typeof email === "string") patch.email = email.trim();

      if (Object.keys(patch).length === 1) {
        return res.status(400).json({ error: "no fields to update" });
      }

      await ref.set(patch, { merge: true });
      res.json({ ok: true, privateClientId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Delete private client (survey admin only)
 * DELETE /api/surveys/:surveyId/private-clients/:privateClientId
 */
r.delete("/surveys/:surveyId/private-clients/:privateClientId",
  requireAuth, requireTenant, requireSurveyAdmin,
  async (req, res) => {
    try {
      const { surveyId, privateClientId } = req.params as any;
      await db.doc(paths.privateClient(surveyId, privateClientId)).delete();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ===========================
 * Projects (per company)
 * =========================== */

/**
 * Create project (contractor admin or survey admin)
 * POST /api/surveys/:surveyId/companies/:companyId/projects
 * body: { name: string }
 */

function ensureProjectWriteAccess(req: any, companyId: string) {
  const role = req.authUser?.claims?.role;
  if (role === "superadmin" || role === "survey_admin") return;
  if (role === "contractor_admin") {
    if (req.authUser?.claims?.contractorId === companyId) return;
    throw Object.assign(new Error("Contractor mismatch"), { status: 403 });
  }
  throw Object.assign(new Error("Forbidden"), { status: 403 });
}

/**
 * Get projects for a company
 * GET /api/surveys/:surveyId/companies/:companyId/projects
 */
r.get("/surveys/:surveyId/companies/:companyId/projects",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId, companyId } = req.params as any;

      const snap = await db.collection(paths.companyProjects(surveyId, companyId)).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      return res.json({ count: rows.length, rows });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/* ===========================
/**
 * Get a single project
 * GET /api/surveys/:surveyId/companies/:companyId/projects/:projectId
 */
r.get("/surveys/:surveyId/companies/:companyId/projects/:projectId",
  requireAuth, requireTenant,
  async (req, res) => {
    try {
      const { surveyId, companyId, projectId } = req.params as any;

      const ref = db.doc(paths.companyProject(surveyId, companyId, projectId));
      const doc = await ref.get();

      if (!doc.exists) return res.status(404).json({ error: "not found" });
      return res.json({ id: doc.id, ...doc.data() });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Create project (survey-level)  ✅ matches your UI
 * POST /api/surveys/:surveyId/projects
 * body: { name: string, companyId: string }
 * Writes to:
 *   - surveys/{surveyId}/companies/{companyId}/projects/{projectId}
 *   - surveys/{surveyId}/projects/{projectId}  (index)
 */
r.post(
  "/surveys/:surveyId/projects",
  requireAuth,
  requireTenant,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { name, companyId, cost, address } = req.body || {};
      console.log("Creating project:", { name, companyId, cost, address });
      if (!name || !companyId ) {
        console.log("Missing required fields");
        return res.status(400).json({ error: "name, companyId, cost, address required" });
      }

      // role check
      try { ensureProjectWriteAccess(req, companyId); } catch (e: any) {
        return res.status(e.status || 403).json({ error: e.message || "Forbidden" });
      }

      // company exists?
      const coRef = db.doc(paths.company(surveyId, companyId));
      const coSnap = await coRef.get();
      if (!coSnap.exists) return res.status(404).json({ error: "company not found" });


      // create project under company
      const projRef = db.collection(`${paths.company(surveyId, companyId)}/projects`).doc();

      const payload = {
        name,
        nameLower: String(name).toLowerCase(),
        companyId,
        surveyId,
        cost: cost,
        address: String(address),
        isActive: true,
        createdAt: serverTimestamp(),
      };

      await projRef.set(payload, { merge: true });

      // mirror into index
      const idxRef = db.doc(`${paths.projectsIndex(surveyId)}/${projRef.id}`);
      await idxRef.set(payload, { merge: true });

      return res.json({ ok: true, projectId: projRef.id });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * List all projects in a survey (across companies) 
 * GET /api/surveys/:surveyId/projects
 */
r.get(
  "/surveys/:surveyId/projects",
  requireAuth,
  requireTenant,
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const snap = await db.collection(paths.projectsIndex(surveyId))
        .orderBy("nameLower", "asc")
        .get();
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      return res.json({ count: rows.length, rows });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Update project by id (survey-level)
 * PATCH /api/surveys/:surveyId/projects/:projectId
 * body: { name?, isActive? ,cost?, address?}
 */
r.patch(
  "/surveys/:surveyId/projects/:projectId",
  requireAuth,
  requireTenant,
  async (req, res) => {
    try {
      const { surveyId, projectId } = req.params as any;

      const patch: any = { updatedAt: serverTimestamp() };

      const { name, isActive, cost, address } = req.body || {};

      // name
      if (typeof name === "string" && name.trim()) {
        patch.name = name.trim();
        patch.nameLower = patch.name.toLowerCase();
      }

      // isActive
      if (typeof isActive === "boolean") patch.isActive = isActive;

      // cost (allow 0? you decide)
      // if you want to allow 0 => use >= 0
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
        patch.cost = cost;
      } else if (typeof cost === "string" && cost.trim() !== "") {
        // in case frontend sends it as string
        const n = Number(cost);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ error: "invalid cost" });
        }
        patch.cost = n;
      }

      // address
      if (typeof address === "string") {
        const a = address.trim();
        // if you want optional address, allow empty => remove this validation
        if (!a) return res.status(400).json({ error: "invalid address" });
        patch.address = a;
        patch.addressLower = a.toLowerCase(); // optional, useful for search
      }

      // ✅ block empty patch requests (optional but recommended)
      if (Object.keys(patch).length === 1) {
        return res.status(400).json({ error: "no valid fields to update" });
      }

      // read index to discover companyId for role check & dual write
      const idxRef = db.doc(`${paths.projectsIndex(surveyId)}/${projectId}`);
      const idxSnap = await idxRef.get();
      if (!idxSnap.exists) return res.status(404).json({ error: "project not found" });

      const { companyId } = idxSnap.data() as any;

      // role check
      try {
        ensureProjectWriteAccess(req, companyId);
      } catch (e: any) {
        return res.status(e.status || 403).json({ error: e.message || "Forbidden" });
      }

      // write both places
      const coRef = db.doc(`${paths.company(surveyId, companyId)}/projects/${projectId}`);
      await Promise.all([
        coRef.set(patch, { merge: true }),
        idxRef.set(patch, { merge: true }),
      ]);

      const after = await idxRef.get();
      return res.json({ id: after.id, ...after.data() });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Delete project by id (survey-level)
 * DELETE /api/surveys/:surveyId/projects/:projectId
 */
r.delete(
  "/surveys/:surveyId/projects/:projectId",
  requireAuth,
  requireTenant,
  async (req, res) => {
    try {
      const { surveyId, projectId } = req.params as any;

      // read index to discover companyId
      const idxRef = db.doc(`${paths.projectsIndex(surveyId)}/${projectId}`);
      const idxSnap = await idxRef.get();
      if (!idxSnap.exists) return res.status(404).json({ error: "project not found" });
      const { companyId } = idxSnap.data() as any;

      // role check
      try { ensureProjectWriteAccess(req, companyId); } catch (e: any) {
        return res.status(e.status || 403).json({ error: e.message || "Forbidden" });
      }

      const coRef = db.doc(`${paths.company(surveyId, companyId)}/projects/${projectId}`);
      await Promise.all([coRef.delete(), idxRef.delete()]);

      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
);


export default r;
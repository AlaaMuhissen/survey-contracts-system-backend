import { requireWorker } from "@middlewares/requireWorker";
import { Router } from "express";
import { auth, db, serverTimestamp } from "../lib/firebase";
import { paths } from "@utils/paths";

const r = Router();

/** Health check */
r.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/** (Optional) public info per survey
 * GET /api/public/surveys/:surveyId/info
 */
r.get("/public/surveys/:surveyId/info", (req, res) => {
  const { surveyId } = req.params;
  res.json({ surveyId, status: "ok" });
});

r.get("/public/surveys/:surveyId/companies",requireWorker, async (req, res) => {
  try {
    const { surveyId } = req.params as any;

    const snapshot = await db.collection(paths.companies(surveyId))
      .orderBy("createdAt", "desc")
      .get();

    const companies = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ ok: true, companies });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
r.get("/public/surveys/:surveyId/companies/:companyId/projects",requireWorker, async (req, res) => {
   try {
    const { surveyId, companyId } = req.params as any;

    const snapshot = await db.collection(paths.companyProjects(surveyId, companyId))
      .orderBy("createdAt", "desc")
      .get();

    const projects = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ ok: true, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


  r.get("/public/surveys/:surveyId/projects",requireWorker, async (req, res) => {
    try {
      const { surveyId } = req.params as { surveyId: string };
      if (!surveyId) return res.status(400).json({ error: "Missing surveyId" });

      // 1) load all companies in this survey
      const companiesSnap = await db.collection(`surveys/${surveyId}/companies`).get();

      // 2) for each company, load its projects
      const allProjectsArrays = await Promise.all(
        companiesSnap.docs.map(async (cDoc) => {
          const companyId = cDoc.id;
          const projectsSnap = await db
            .collection(`surveys/${surveyId}/companies/${companyId}/projects`)
            .get();

          return projectsSnap.docs.map((pDoc) => {
            const data = pDoc.data() || {};
            return {
              id: pDoc.id,
              companyId,
              name: String(data.name || ""),
              active: data.active !== false, // default true
            };
          });
        })
      );

      const projects = allProjectsArrays.flat();

      // optional: sort by company/name
      projects.sort((a, b) =>
        (a.companyId + a.name).localeCompare(b.companyId + b.name)
      );

      // optional caching headers (public endpoint)
      res.setHeader("Cache-Control", "no-store");

      return res.json({ ok: true, projects });
    } catch (e: any) {
      console.error("public projects error:", e);
      return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
    }
  });

export default r;

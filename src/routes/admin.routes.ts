import type { Express, Request, Response } from "express";
import { z } from "zod";
import { adminKeyAuth } from "@middlewares/adminKeyAuth.js";
import { initAdminKey, getAdminKeyMeta, rotateAdminKey } from "@services/admin-key.service.js";
import { createProject, listProjects, patchProject, deleteProject } from "@services/projects.service.js";
import { createCompany, listCompanies, deleteCompanyAndProjects } from "@services/companies.service.js";
import { listWorklogs } from "@services/worklogs.service.js";

// Reuse your validation shape for key rotation
const RotateSchema = z.object({
  confirmKey: z.string().min(1),
  newKey: z
    .string()
    .optional()
    .refine(v => !v || v.length >= 16 || v.trim().split(/\s+/).length >= 4,
      "Key too weak: use ≥16 chars or a 4+ word passphrase"),
  graceHours: z.number().int().min(0).max(72).optional(),
});

export function registerAdminRoutes(app: Express) {
  // --- Admin Key management ---
  app.post("/admin/key/init", async (req: Request, res: Response) => {
    try {
      const { key } = req.body || {};
      if (!key) return res.status(400).json({ error: "Missing key" });
      const r = await initAdminKey(String(key));
      res.json(r);
    } catch (e) {
      console.error("init key error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/admin/key/meta", adminKeyAuth, async (_req: Request, res: Response) => {
    const meta = await getAdminKeyMeta();
    res.json(meta);
  });

  app.post("/admin/key/rotate", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const parsed = RotateSchema.parse(req.body || {});
      const r = await rotateAdminKey(parsed);
      res.json(r);
    } catch (e: any) {
      if (e?.issues) return res.status(400).json({ error: e.issues[0]?.message || "Bad input" });
      const status = e?.status || 500;
      console.error("rotate key error:", e);
      res.status(status).json({ error: status === 401 ? "Wrong current key" : "Internal error" });
    }
  });
  app.get("/admin/worklogs", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const { limit = "25", cursor, q } = req.query as {
        limit?: string; cursor?: string; q?: string;
      };

      // choose ONE of the query patterns (see my previous message). example uses service:
      const { items, nextCursor } = await listWorklogs({
        limit: Number(limit),
        cursorMs: cursor ? Number(cursor) : null,
        q: q || null,
      });

      res.json({ items, nextCursor });
    } catch (e) {
      console.error("admin list error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // --- Projects ---
  app.post("/admin/projects", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name || "");
      const companyId = String(req.body?.companyId || "");
      const r = await createProject({ name, companyId });
      res.json(r);
    } catch (e: any) {
      const status = /not found/i.test(String(e?.message)) ? 404 : 500;
      console.error("add project error:", e);
      res.status(status).json({ error: status === 404 ? "Company not found" : "Internal error" });
    }
  });

  app.get("/admin/projects", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const companyId = (req.query.companyId as string | undefined) || undefined;
      const r = await listProjects(companyId);
      res.json(r);
    } catch (e: any) {
      console.error("list projects error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.patch("/admin/projects/:id", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const patch: { isActive?: boolean; name?: string } = {};
      if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;
      if (req.body?.name) patch.name = String(req.body.name);
      const r = await patchProject(id, patch);
      res.json(r);
    } catch (e: any) {
      if (/Nothing to update/i.test(String(e?.message))) {
        return res.status(400).json({ error: "Nothing to update" });
      }
      console.error("patch project error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.delete("/admin/projects/:id", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const r = await deleteProject(id);
      res.json(r);
    } catch (e: any) {
      console.error("delete project error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // --- Companies ---
  app.post("/admin/companies", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name || "");
      const r = await createCompany(name);
      res.json(r);
    } catch (e: any) {
      console.error("add company error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/admin/companies", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(100, Number(req.query.limit || 50));
      const q = String(req.query.q || "");
      const r = await listCompanies(limit, q);
      res.json(r);
    } catch (e: any) {
      console.error("list companies error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.delete("/admin/companies/:id", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const r = await deleteCompanyAndProjects(id);
      res.json(r);
    } catch (e: any) {
      console.error("delete company (with projects) error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });
}

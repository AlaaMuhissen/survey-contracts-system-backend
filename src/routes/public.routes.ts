// src/routes/public.routes.ts
import type { Express, Request, Response } from "express";
import { db } from "@lib/firebase.js";
import { listProjects } from "@services/projects.service.js";

export function registerPublicRoutes(app: Express) {
  // GET /public/companies  ->  [{id, name, active?}]
  app.get("/public/companies", async (_req: Request, res: Response) => {
    try {
      const snap = await db.collection("companies").orderBy("name").get();
      const items = snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, name: data.name || "", active: data.active ?? true };
      });
      res.json({ items, updatedAt: Date.now() });
    } catch (e: any) {
      console.error("list companies error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /public/projects?companyId=abc123
  app.get("/public/projects", async (req: Request, res: Response) => {
    try {
      const companyId = String(req.query.companyId || "");
      if (!companyId) return res.status(400).json({ error: "Missing companyId" });

      const { items } = await listProjects(companyId);
      const filtered = items
        .filter((p: any) => p.active !== false)
        .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || ""), "he"));

      res.json({ items: filtered, updatedAt: Date.now() });
    } catch (e: any) {
      console.error("list projects error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });
}

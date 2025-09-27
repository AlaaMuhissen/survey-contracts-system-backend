import type { Express, Request, Response } from "express";
import { adminKeyAuth } from "@middlewares/adminKeyAuth.js";
import { db } from "@lib/firebase.js";
import { toDayStr, toMonthStr, coalesceDate } from "@utils/dates.js";

// NOTE: This reproduces your current aggregations, organized inside route handlers.

export function registerReportRoutes(app: Express) {
  // GET /admin/reports/summary
  app.get("/admin/reports/summary", adminKeyAuth, async (req: Request, res: Response) => {
    const { from, to, company, project } = req.query as any;

    let q: FirebaseFirestore.Query = db.collection("worklogs");
    if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)   q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));
    if (company) q = q.where("company", "==", company);
    if (project) q = q.where("project", "==", project);

    const snap = await q.get();
    const byDay: Record<string,{all:number,full:number,half:number}> = {};
    const byMonth: Record<string,{all:number,full:number,half:number}> = {};
    let full = 0, half = 0;

    snap.forEach(d => {
      const w = d.data() as any;
      const dt = coalesceDate(w.createdAt);
      const day = toDayStr(dt);
      const month = toMonthStr(dt);
      const kind = w.dayType === "half" ? "half" : "full";

      byDay[day]   ??= { all:0, full:0, half:0 };
      byMonth[month]??= { all:0, full:0, half:0 };

      byDay[day].all++; byMonth[month].all++;
      byDay[day][kind]++; byMonth[month][kind]++;
      kind === "half" ? half++ : full++;
    });

    res.json({
      totals: { all: full + half, full, half },
      byDay:   Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).map(([date,v]) => ({ date, ...v })),
      byMonth: Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month,v]) => ({ month, ...v })),
    });
  });

  // GET /admin/reports/company-project-days
  app.get("/admin/reports/company-project-days", adminKeyAuth, async (req: Request, res: Response) => {
    try {
      let { from, to, company, project, format, all } = req.query as any;

      const includeAll = all === "1" || all === "true";
      const coQ = (typeof company === "string" ? company : "").trim().toLowerCase();
      const prQ = (typeof project === "string" ? project : "").trim().toLowerCase();

      const startDate = (typeof from === "string" && from) ? new Date(`${from}T00:00:00Z`) : null;
      const endDate   = (typeof to   === "string" && to)   ? new Date(`${to}T23:59:59Z`) : null;

      // base fetch (no composite index)
      const snap = await db.collection("workLogs").get();

      type Rec = { days: Set<string>; full: number; half: number };
      const agg = new Map<string, Map<string, Rec>>();

      const keep = (w: any) => {
        const dt = coalesceDate(w.createdAt);
        if (!includeAll) {
          if (startDate && dt < startDate) return false;
          if (endDate   && dt > endDate)   return false;
        }
        const co = ((w.company ?? "") + "").trim().toLowerCase();
        const pr = ((w.project ?? "") + "").trim().toLowerCase();
        if (coQ && co !== coQ) return false;
        if (prQ && pr !== prQ) return false;
        return true;
      };

      for (const d of snap.docs) {
        const w = d.data() as any;
        if (!keep(w)) continue;

        const companyName = ((w.company ?? "—") + "").trim();
        const projectName = ((w.project ?? "—") + "").trim();
        const kind: "full" | "half" = w.dayType === "half" ? "half" : "full";
        const dayStr = toDayStr(coalesceDate(w.createdAt));

        if (!agg.has(companyName)) agg.set(companyName, new Map());
        const byProj = agg.get(companyName)!;

        if (!byProj.has(projectName)) byProj.set(projectName, { days: new Set<string>(), full: 0, half: 0 });
        const rec = byProj.get(projectName)!;

        rec.days.add(dayStr);
        if (kind === "half") rec.half++; else rec.full++;
      }

      const rows = [] as Array<{ company: string; project: string; fullCount: number; halfCount: number; logsTotal: number }>;
      for (const [co, byProj] of agg.entries()) {
        for (const [pr, rec] of byProj.entries()) {
          rows.push({
            company: co,
            project: pr,
            fullCount: rec.full,
            halfCount: rec.half,
            logsTotal: rec.full + rec.half * 0.5,
          });
        }
      }

      rows.sort((a,b) =>
        a.company.localeCompare(b.company, "he") || a.project.localeCompare(b.project, "he")
      );

      if (format === "csv") {
        const header = "company,project,uniqueDays,fullCount,halfCount,logsTotal\n";
        const body = rows.map(r => [
          JSON.stringify(r.company),
          JSON.stringify(r.project),
          r.fullCount, r.halfCount, r.logsTotal
        ].join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
    
        return res.send(header + body);
      } else {

        res.json({ from: from || null, to: to || null, count: rows.length, rows });
      }
    } catch (e: any) {
      console.error("[report] error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /admin/reports/by-company
  app.get("/admin/reports/by-company", adminKeyAuth, async (req: Request, res: Response) => {
    const { from, to } = req.query as any;
    let q: FirebaseFirestore.Query = db.collection("workLogs");
    if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)   q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));

    const snap = await q.get();
    const map = new Map<string,{all:number,full:number,half:number}>();
    let total = 0;

    snap.forEach(d => {
      const w = d.data() as any;
      const key = (w.company || "—").trim();
      const r = map.get(key) || { all:0, full:0, half:0 };
      r.all++; total++;
      if (w.dayType === "half") r.half++; else r.full++;
      map.set(key, r);
    });

    const rows = [...map.entries()]
      .map(([company,v]) => ({ company, ...v, pct: total ? +(v.all*100/total).toFixed(1) : 0 }))
      .sort((a,b)=>b.all - a.all);

    res.json({ rows, total });
  });

  // GET /admin/reports/worker-utilization
  app.get("/admin/reports/worker-utilization", adminKeyAuth, async (req: Request, res: Response) => {
    const { from, to, company, project, workerId, format } = req.query as any;

    let q: FirebaseFirestore.Query = db.collection("worklogs");
    if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)   q = q.where("createdAt", "<=", new Date(to   + "T23:59:59Z"));
    if (company) q = q.where("company", "==", company);
    if (project) q = q.where("project", "==", project);
    if (workerId) q = q.where("workerId", "==", workerId);
    q = q.orderBy("createdAt", "asc");

    const snap = await q.get();

    type RowKey = string;
    const m = new Map<RowKey, {
      workerId: string;
      worker: string;
      company?: string;
      project?: string;
      fullCount: number;
      halfCount: number;
      logsTotal: number;
      dates: Set<string>;
    }>();

    snap.forEach(d => {
      const w = d.data() as any;
      const dt = coalesceDate(w.createdAt);
      const day = toDayStr(dt);
      const kind: "full" | "half" = w.dayType === "half" ? "half" : "full";

      const key = `${w.workerId}|${company ? w.company : ""}|${project ? w.project : ""}`;
      const row = m.get(key) ?? {
        workerId: w.workerId || "",
        worker: w.workerName || w.worker || "",
        company: company ? (w.company || company) : "",
        project: project ? (w.project || project) : "",
        fullCount: 0,
        halfCount: 0,
        logsTotal: 0,
        dates: new Set<string>(),
      };

      kind === "half" ? row.halfCount++ : row.fullCount++;
      row.logsTotal++;
      row.dates.add(day);

      m.set(key, row);
    });

    const rows = Array.from(m.values()).map(r => ({
      workerId: r.workerId,
      worker: r.worker,
      company: r.company || "",
      project: r.project || "",
      FTE_days: r.fullCount + 0.5 * r.halfCount,
      uniqueDays: r.dates.size,
      fullCount: r.fullCount,
      halfCount: r.halfCount,
      logsTotal: r.logsTotal,
    })).sort((a,b)=> b.FTE_days - a.FTE_days);

    if (format === "csv") {
      const wrap = (s:any) => {
        const v = String(s ?? "");
        return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
      };
      const header = "workerId,worker,company,project,FTE_days,uniqueDays,fullCount,halfCount,logsTotal";
      const csv = [header, ...rows.map(r =>
        [r.workerId, wrap(r.worker), wrap(r.company), wrap(r.project),
         r.FTE_days, r.uniqueDays, r.fullCount, r.halfCount, r.logsTotal].join(",")
      )].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.send(csv);
    }

    res.json({ rows });
  });

  // GET /admin/reports/company-summary
  app.get("/admin/reports/company-summary", adminKeyAuth, async (req: Request, res: Response) => {
    const { from, to, format } = req.query as any;

    let q: FirebaseFirestore.Query = db.collection("worklogs");
    if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)   q = q.where("createdAt", "<=", new Date(to   + "T23:59:59Z"));
    q = q.orderBy("createdAt", "asc");

    const snap = await q.get();

    const m = new Map<string, {
      company: string;
      fullCount: number;
      halfCount: number;
      logsTotal: number;
      dates: Set<string>;
      workers: Set<string>;
      projects: Set<string>;
    }>();

    snap.forEach(d => {
      const w = d.data() as any;
      const day = toDayStr(coalesceDate(w.createdAt));
      const company = w.company || "—";
      const kind: "full" | "half" = w.dayType === "half" ? "half" : "full";

      const row = m.get(company) ?? {
        company,
        fullCount: 0,
        halfCount: 0,
        logsTotal: 0,
        dates: new Set<string>(),
        workers: new Set<string>(),
        projects: new Set<string>(),
      };

      kind === "half" ? row.halfCount++ : row.fullCount++;
      row.logsTotal++;
      row.dates.add(day);
      if (w.workerId) row.workers.add(w.workerId);
      if (w.projectId || w.project) row.projects.add(w.projectId || w.project);

      m.set(company, row);
    });

    const rows = Array.from(m.values()).map(r => ({
      company: r.company,
      FTE_days: r.fullCount + 0.5 * r.halfCount,
      uniqueDays: r.dates.size,
      workersCount: r.workers.size,
      projectsCount: r.projects.size,
      logsTotal: r.logsTotal,
      fullCount: r.fullCount,
      halfCount: r.halfCount,
    })).sort((a,b)=> b.FTE_days - a.FTE_days);

    if (format === "csv") {
      const wrap = (s:any) => {
        const v = String(s ?? "");
        return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
      };
      const header = "company,FTE_days,uniqueDays,workersCount,projectsCount,logsTotal,fullCount,halfCount";
      const csv = [header, ...rows.map(r =>
        [wrap(r.company), r.FTE_days, r.uniqueDays, r.workersCount, r.projectsCount,
         r.logsTotal, r.fullCount, r.halfCount].join(",")
      )].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.send(csv);
    }

    res.json({ rows });
  });
}

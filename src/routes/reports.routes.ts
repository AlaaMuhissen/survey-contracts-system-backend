import type { Express, Request, Response } from "express";
import { Router } from "express";
import { db } from "../lib/firebase";
import { requireAuth } from "../middlewares/requireAuth";
import { requireTenant } from "../middlewares/requireTenant";
// If you want to restrict to survey admins only, import your guard:
// import { requireSurveyAdmin } from "../middlewares/require-admin";
import { paths } from "../utils/paths";
import { toDayStr, toMonthStr, coalesceDate } from "../utils/dates";
import { console } from "inspector";



const r = Router();

  // ===========================
  // GET /surveys/:surveyId/reports/summary
  // ===========================
  r.get(
    "/surveys/:surveyId/reports/summary",
    requireAuth,
    requireTenant,
    // requireSurveyAdmin, // <-- optionally enforce survey-admin only
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const { from, to, company, project } = req.query as any;

        let q: FirebaseFirestore.Query = db.collection(paths.workLogs(surveyId));
        if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
        if (to)   q = q.where("createdAt", "<=", new Date(to   + "T23:59:59Z"));
        if (company) q = q.where("company", "==", company);
        if (project) q = q.where("project", "==", project);

        const snap = await q.get();
        const byDay:   Record<string, { all:number; full:number; half:number }> = {};
        const byMonth: Record<string, { all:number; full:number; half:number }> = {};
        let full = 0, half = 0;

        snap.forEach(d => {
          const w = d.data() as any;
          const dt = coalesceDate(w.createdAt);
          const day = toDayStr(dt);
          const month = toMonthStr(dt);
          const kind = w.dayType === "half" ? "half" : "full";

          byDay[day]     ??= { all:0, full:0, half:0 };
          byMonth[month] ??= { all:0, full:0, half:0 };

          byDay[day].all++; byMonth[month].all++;
          byDay[day][kind]++; byMonth[month][kind]++;
          kind === "half" ? half++ : full++;
        });

        res.json({
          totals: { all: full + half, full, half },
          byDay:   Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).map(([date,v]) => ({ date, ...v })),
          byMonth: Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month,v]) => ({ month, ...v })),
        });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ===========================
  // GET /surveys/:surveyId/reports/company-project-days
  // ===========================
  r.get(
    "/surveys/:surveyId/reports/company-project-days",
    requireAuth,
    requireTenant,
    // requireSurveyAdmin,
    async (req: Request, res: Response) => {
      try {
    
        const { surveyId } = req.params as any;
        let { from, to, company, project, companyIds, projectIds, privateClientIds, format, all } = req.query as any;
        const includeAll = all === "1" || all === "true";
        const coQ = (typeof company === "string" ? company : "").trim().toLowerCase();
        const prQ = (typeof project === "string" ? project : "").trim().toLowerCase();

        // Multi-select checklists: comma-separated ids. The param being
        // ABSENT means "no filter" (all) — but the frontend now defaults
        // its checkboxes to all-checked and sends the full explicit list,
        // so in practice this only matters for other/future callers. The
        // param being PRESENT but empty (admin unchecked everything) means
        // "match nothing" for that section — an empty Set, not null, so the
        // `set && !set.has(...)` check below still filters every row out.
        const parseIdSet = (v: any): Set<string> | null => {
          if (typeof v !== "string") return null;
          const items = v.trim().split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
          return new Set(items);
        };
        const companyIdSet = parseIdSet(companyIds);
        const projectIdSet = parseIdSet(projectIds);
        const privateClientIdSet = parseIdSet(privateClientIds);

        console.log("Filters:", { coQ, prQ, includeAll, companyIdSet, projectIdSet, privateClientIdSet });
        const startDate = (typeof from === "string" && from) ? new Date(`${from}T00:00:00Z`) : null;
        const endDate   = (typeof to   === "string" && to)   ? new Date(`${to}T23:59:59Z`)   : null;

        // base fetch (no composite index filter here; filter in memory)
        const snap = await db.collection(paths.workLogs(surveyId)).get();
        // --- projects meta (cost) ---
        const projectsSnap = await db.collection(paths.projects(surveyId)).get();
        // if your path is different, change paths.projects(surveyId)

        const projectMetaById = new Map<string, { cost: number }>();

        for (const p of projectsSnap.docs) {
          const pr = p.data() as any;
          const id = (p.id || "").trim();
          const cost = Number(pr.cost ?? pr.price ?? 0); // adapt field name: cost/price/...
          projectMetaById.set(id, { cost: Number.isFinite(cost) ? cost : 0 });
        }

        // --- private clients meta (price) — "private" companyId rows have no
        // matching doc in `projects`, so their cost is looked up here instead ---
        const privateClientsSnap = await db.collection(paths.privateClients(surveyId)).get();
        const privateClientMetaById = new Map<string, { name: string; price: number }>();

        for (const p of privateClientsSnap.docs) {
          const pc = p.data() as any;
          const price = Number(pc.price ?? 0);
          privateClientMetaById.set(p.id, {
            name: String(pc.name || ""),
            price: Number.isFinite(price) ? price : 0,
          });
        }

        const PRIVATE_COMPANY_LABEL = "שירות פרטי";

        type Rec = {
          days: Set<string>;
          full: number;
          half: number;
          companyName: string;
          projectName: string;
          pdfUrls: Set<string>;
          isPrivate: boolean;
        };

        const agg = new Map<string, Map<string, Rec>>(); 

        const keep = (w: any) => {
          const dt = coalesceDate(w.createdAt);
          if (!includeAll) {
            if (startDate && dt < startDate) return false;
            if (endDate   && dt > endDate)   return false;
          }
          const co = ((w.company ?? "") + "").trim().toLowerCase();
          const pr = ((w.project ?? "") + "").trim().toLowerCase();
          const coId = ((w.companyId ?? "") + "").trim().toLowerCase();
          const prId = ((w.projectId ?? "") + "").trim().toLowerCase();
          if (coQ && co !== coQ) return false;
          if (prQ && pr !== prQ) return false;
          return true;
        };

        for (const d of snap.docs) {
          const w = d.data() as any;
          if (!keep(w)) continue;

          const companyIdVal = ((w.companyId ?? "") + "").trim();
          const isPrivate = companyIdVal === "private" || w.isPrivate === true;
          // the persisted doc's companyId field is often "" for private logs
          // (the worker form clears form.companyId on mode switch, and only
          // the URL route param — not the doc itself — used to say
          // "private") — this is the value actually used for grouping/
          // filtering below, so it doesn't matter whether the raw field was
          // ever populated.
          const effectiveCompanyId = isPrivate ? "private" : companyIdVal;

          // private-service logs never populate w.company/w.project (the
          // worker form clears them on mode switch), and are grouped by
          // privateClientId rather than the placeholder projectId — fall
          // back to it only if the client wasn't resolved for some reason.
          const privateClientId = ((w.privateClientId ?? "") + "").trim();
          const projectIdVal = isPrivate
            ? (privateClientId || ((w.projectId ?? "") + "").trim())
            : ((w.projectId ?? "") + "").trim();

          const companyName = isPrivate
            ? PRIVATE_COMPANY_LABEL
            : ((w.company ?? "—") + "").trim();
          const projectName = isPrivate
            ? (((w.privateClientName ?? privateClientMetaById.get(projectIdVal)?.name) ?? "—") + "").trim()
            : ((w.project ?? "—") + "").trim();

          // Company/project use OR semantics, not AND: fully selecting a
          // company in the UI (its master checkbox) means "everything under
          // this company, including projects added later" — sent as
          // companyIds. Individually checking specific projects (without
          // fully selecting their company) is sent as projectIds. A row
          // passes if EITHER matches, so a company-level pick isn't
          // constrained by exactly which project ids happened to exist at
          // selection time.
          if (!isPrivate && (companyIdSet !== null || projectIdSet !== null)) {
            const matchesCompany = companyIdSet !== null && companyIdSet.has(effectiveCompanyId.toLowerCase());
            const matchesProject = projectIdSet !== null && projectIdSet.has(projectIdVal.toLowerCase());
            if (!matchesCompany && !matchesProject) continue;
          }
          if (isPrivate && privateClientIdSet && !privateClientIdSet.has(projectIdVal.toLowerCase())) continue;

          const kind: "full" | "half" = w.dayType === "half" ? "half" : "full";
          const dayStr = toDayStr(coalesceDate(w.createdAt));

        
          const coId = effectiveCompanyId;
          const prId = projectIdVal;

          if (!coId || !prId) continue; // optional: skip broken rows

          if (!agg.has(coId)) agg.set(coId, new Map());
          const byProj = agg.get(coId)!;

          if (!byProj.has(prId)) {
            byProj.set(prId, {
              days: new Set<string>(),
              full: 0,
              half: 0,
              companyName,
              projectName,
              pdfUrls: new Set<string>(), 
              isPrivate,
            });
          }

          const rec = byProj.get(prId)!;

          if (w.fileUrl && typeof w.fileUrl === "string") {
            rec.pdfUrls.add(w.fileUrl);
          }
          rec.days.add(dayStr);
          if (kind === "half") rec.half++; else rec.full++;
          
        }

        const rows = [] as Array<{
          company: string;
          project: string;
          companyId: string;
          projectId: string;
          fullCount: number;
          halfCount: number;
          logsTotal: number;
          projectCost: number;     
          totalCost: number;   
          pdfUrls: string[];   
        }>;

        for (const [coId, byProj] of agg.entries()) {
          for (const [prId, rec] of byProj.entries()) {
            const projectCost = rec.isPrivate
              ? (privateClientMetaById.get(prId)?.price ?? 0)
              : (projectMetaById.get(prId)?.cost ?? 0);
            const logsTotal = rec.full + rec.half * 0.5;

            rows.push({
              company: rec.companyName,
              companyId: coId,
              project: rec.projectName,
              projectId: prId,
              fullCount: rec.full,
              halfCount: rec.half,
              logsTotal,
              projectCost,
              totalCost: logsTotal * projectCost,
              pdfUrls: Array.from(rec.pdfUrls),
            });
          }
        }



        rows.sort((a,b) =>
          a.company.localeCompare(b.company, "he") || a.project.localeCompare(b.project, "he")
        );

        if (format === "csv") {
          const header = "company,project,cost,fullCount,halfCount,logsTotal,totalCost\n";
          const body = rows.map(r => [
            JSON.stringify(r.company),
            JSON.stringify(r.project),
            r.projectCost, r.fullCount, r.halfCount, r.logsTotal, r.totalCost
          ].join(",")).join("\n");
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          return res.send(header + body);
        }

        res.json({ from: from || null, to: to || null, count: rows.length, rows });
      } catch (e: any) {
        console.error("[report] error:", e);
        res.status(500).json({ error: "Internal error" });
      }
    }
  );

  // ===========================
  // GET /surveys/:surveyId/reports/by-company
  // ===========================
  r.get(
    "/surveys/:surveyId/reports/by-company",
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const { from, to } = req.query as any;

        let q: FirebaseFirestore.Query = db.collection(paths.workLogs(surveyId));
        if (from) q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
        if (to)   q = q.where("createdAt", "<=", new Date(to   + "T23:59:59Z"));

        const snap = await q.get();
        const map = new Map<string, { all:number; full:number; half:number }>();
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
          .sort((a,b)=> b.all - a.all);

        res.json({ rows, total });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ===========================
  // GET /surveys/:surveyId/reports/worker-utilization
  // ===========================
  r.get(
    "/surveys/:surveyId/reports/worker-utilization",
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const { from, to, company, project, workerId, format } = req.query as any;

        let q: FirebaseFirestore.Query = db.collection(paths.workLogs(surveyId));
        if (from)    q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
        if (to)      q = q.where("createdAt", "<=", new Date(to   + "T23:59:59Z"));
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
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ===========================
  // GET /surveys/:surveyId/reports/company-summary
  // ===========================
  r.get(
    "/surveys/:surveyId/reports/company-summary",
    requireAuth,
    requireTenant,
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const { from, to, format } = req.query as any;

        let q: FirebaseFirestore.Query = db.collection(paths.workLogs(surveyId));
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
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );
export default r;
import type { Express, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireTenant } from "../middlewares/requireTenant";

import { getNextSerial, uploadWorklogPdf } from "@services/worklogs.service.js";
import { requireWorker } from "@middlewares/requireWorker";
import { db } from "@lib/firebase.js";
import { paths } from "../utils/paths";


const r = Router();
/** Optional role guard: who can post worklogs */
function requireCanPostWorklog(req: Request, res: Response, next: Function) {
  const role = req.authUser?.claims.role;
  if (
    role === "superadmin" ||
    role === "survey_admin" ||
    role === "contractor_admin" ||
    role === "worker"
  ) return next();
  return res.status(403).json({ error: "Not allowed to post work logs" });
}

  /**
   * A worker's own work logs — for the "my worklogs" page (status +
   * reshare). Sorted in JS rather than via Firestore orderBy, same reason
   * as pendingSignatures: avoids needing a composite index for a bounded,
   * limit(200) list.
   * GET /surveys/:surveyId/workLogs/mine
   */
  r.get(
    "/surveys/:surveyId/workLogs/mine",
    requireWorker,
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const workerId = req.authUser?.uid;
        if (!workerId) return res.status(401).json({ error: "Missing worker" });

        const snap = await db
          .collection(paths.workLogs(surveyId))
          .where("workerId", "==", workerId)
          .limit(200)
          .get();

        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a: any, b: any) => {
          const at = a.createdAt?._seconds ?? a.createdAt?.seconds ?? 0;
          const bt = b.createdAt?._seconds ?? b.createdAt?.seconds ?? 0;
          return bt - at; // newest first
        });

        res.json({ ok: true, items });
      } catch (e: any) {
        console.error("workLogs/mine error:", e);
        res.status(500).json({ error: "Internal error" });
      }
    }
  );

  /**
   * Reserve/preview next worklog number (per survey)
   * POST /surveys/:surveyId/workLogs/next-number
   * body: { width?: number }
   */
  r.post(
    "/surveys/:surveyId/workLogs/next-number",
    requireWorker,
    async (req: Request, res: Response) => {
      try {
        const { surveyId } = req.params as any;
        const { width = 5 } = (req.body || {}) as { width?: number };
        const { serial, seq } = await getNextSerial(surveyId, { width });
        res.json({ ok: true, number: serial, seq });
      } catch (e: any) {
        console.error("next-number error:", e);
        res.status(500).json({ error: "Internal error" });
      }
    }
  );

  /**
   * Upload a worklog PDF (scoped to survey)
   * POST /surveys/:surveyId/workLogs/upload-json
   * body: { meta: {...}, pdfBase64: "data:application/pdf;base64,..." }
   * - meta.number and meta.seq are optional (if you reserved already)
   */
 r.post(
  "/surveys/:surveyId/companies/:companyId/projects/:projectId/workLogs/upload-json",
  requireWorker,
  requireCanPostWorklog,
  async (req: Request, res: Response) => {
    try {
      const { companyId, projectId, surveyId } = req.params as {
        companyId: string;
        projectId: string;
        surveyId: string;
      };

      const { meta = {}, pdfBase64 } = (req.body || {}) as {
        meta?: Record<string, any>;
        pdfBase64?: string;
      };

      if (!pdfBase64) {
        return res.status(400).json({ error: "Missing pdfBase64" });
      }

      // accept provided number/seq from client (after reservation)
      const providedNumber = String(meta.number || "").trim() || undefined;
      const providedSeq =
        Number.isFinite(meta.seq) && meta.seq !== null ? Number(meta.seq) : undefined;

      const out = await uploadWorklogPdf({
        companyId,
        projectId,
        surveyId,
        meta,
        pdfBase64,
        serial: providedNumber,
        seq: providedSeq,
        width: 5,
        workerId: req.authUser?.uid,
      });

      return res.json({ ok: true, ...out });
    } catch (e: any) {
      if (e?.code === "SERIAL_TAKEN") {
        return res.status(409).json({
          error: "Serial already used",
          number: e.serial,
        });
      }

      console.error("upload-json error:", e);
      return res.status(500).json({
        error: "Internal error",
        details: String(e?.message || e),
      });
    }
  }
);

export default r;

// import type { Express, Request, Response } from "express";
// import { adminKeyAuth } from "@middlewares/adminKeyAuth.js";
// import { getNextSerial, uploadWorklogPdf } from "@services/worklogs.service.js";

// export function registerWorklogRoutes(app: Express) {
//   // POST /worklogs/next-number
//   app.post("/worklogs/next-number", async (_req: Request, res: Response) => {
//     try {
//       const { serial, seq } = await getNextSerial({ width: 5 });
//       res.json({ ok: true, number: serial, seq });
//     } catch (e: any) {
//       console.error("next-number error:", e);
//       res.status(500).json({ error: "Internal error" });
//     }
//   });

//   // POST /worklogs/upload-json
//   app.post("/worklogs/upload-json", async (req: Request, res: Response) => {
//     try {
//       const { meta = {}, pdfBase64 } = (req.body || {}) as {
//         meta?: Record<string, any>;
//         pdfBase64?: string;
//       };
//       if (!pdfBase64) return res.status(400).json({ error: "Missing pdfBase64" });

//       // accept provided number/seq from client (after reservation)
//       const providedNumber = String(meta.number || "").trim() || undefined;
//       const providedSeq =
//         Number.isFinite(meta.seq) && meta.seq !== null ? Number(meta.seq) : undefined;

//       const out = await uploadWorklogPdf({
//         meta,
//         pdfBase64,
//         serial: providedNumber,
//         seq: providedSeq,
//         width: 5,
//       });

//       return res.json({ ok: true, ...out });
//     } catch (e: any) {
//       if (e?.code === "SERIAL_TAKEN") {
//         return res.status(409).json({ error: "Serial already used", number: e.serial });
//       }
//       console.error("upload-json error:", e);
//       return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
//     }
//   });

// }as
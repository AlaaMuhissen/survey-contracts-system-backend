import type { Express, Request, Response } from "express";
import { adminKeyAuth } from "@middlewares/adminKeyAuth.js";
import { getNextSerial, uploadWorklogPdf } from "@services/worklogs.service.js";

export function registerWorklogRoutes(app: Express) {
  // POST /worklogs/next-number
  app.post("/worklogs/next-number", async (_req: Request, res: Response) => {
    try {
      const { serial, seq } = await getNextSerial({ width: 5 });
      res.json({ ok: true, number: serial, seq });
    } catch (e: any) {
      console.error("next-number error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // POST /worklogs/upload-json
  app.post("/worklogs/upload-json", async (req: Request, res: Response) => {
    try {
      const { meta = {}, pdfBase64 } = (req.body || {}) as {
        meta?: Record<string, any>;
        pdfBase64?: string;
      };
      if (!pdfBase64) return res.status(400).json({ error: "Missing pdfBase64" });

      // accept provided number/seq from client (after reservation)
      const providedNumber = String(meta.number || "").trim() || undefined;
      const providedSeq =
        Number.isFinite(meta.seq) && meta.seq !== null ? Number(meta.seq) : undefined;

      const out = await uploadWorklogPdf({
        meta,
        pdfBase64,
        serial: providedNumber,
        seq: providedSeq,
        width: 5,
      });

      return res.json({ ok: true, ...out });
    } catch (e: any) {
      if (e?.code === "SERIAL_TAKEN") {
        return res.status(409).json({ error: "Serial already used", number: e.serial });
      }
      console.error("upload-json error:", e);
      return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
    }
  });

}
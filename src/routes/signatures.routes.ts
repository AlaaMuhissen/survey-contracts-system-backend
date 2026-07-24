import { Router, Request, Response } from "express";
import { requireWorker } from "@middlewares/requireWorker";
import {
  createPendingSignature,
  getPendingSignature,
  signPendingSignature,
  listPendingSignatures,
  deletePendingSignature,
} from "../services/pendingSignatures.service";

const r = Router();

/**
 * Worker creates a "send for manager signature" request.
 * POST /surveys/:surveyId/pending-signatures
 * body: { formSnapshot: {...}, sigLead?: [...], sigMeta?: {...} }
 * → { ok: true, token }
 */
r.post("/surveys/:surveyId/pending-signatures", requireWorker, async (req: Request, res: Response) => {
  try {
    const { surveyId } = req.params as any;
    const workerId = req.authUser?.uid;
    if (!workerId) return res.status(401).json({ error: "Missing worker" });

    const { formSnapshot, sigLead, sigMeta } = req.body || {};
    if (!formSnapshot || typeof formSnapshot !== "object") {
      return res.status(400).json({ error: "formSnapshot required" });
    }

    const token = await createPendingSignature(surveyId, { workerId, formSnapshot, sigLead, sigMeta });
    res.json({ ok: true, token });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Worker lists their own pending/signed requests (to check status and pull
 * a signed one back into the form).
 * GET /surveys/:surveyId/pending-signatures
 */
r.get("/surveys/:surveyId/pending-signatures", requireWorker, async (req: Request, res: Response) => {
  try {
    const { surveyId } = req.params as any;
    const workerId = req.authUser?.uid;
    if (!workerId) return res.status(401).json({ error: "Missing worker" });

    const items = await listPendingSignatures(surveyId, workerId);
    res.json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Worker fetches one request by token (e.g. right after creating it, or to
 * pull the signed result back into the open form).
 * GET /surveys/:surveyId/pending-signatures/:token
 */
r.get("/surveys/:surveyId/pending-signatures/:token", requireWorker, async (req: Request, res: Response) => {
  try {
    const { surveyId, token } = req.params as any;
    const workerId = req.authUser?.uid;
    const item = await getPendingSignature(surveyId, token);
    if (!item || item.workerId !== workerId) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, item });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Worker deletes a request once they've pulled it back into the form (or
 * decided not to use it) — keeps the list clean.
 * DELETE /surveys/:surveyId/pending-signatures/:token
 */
r.delete("/surveys/:surveyId/pending-signatures/:token", requireWorker, async (req: Request, res: Response) => {
  try {
    const { surveyId, token } = req.params as any;
    const workerId = req.authUser?.uid;
    const item = await getPendingSignature(surveyId, token);
    if (!item || item.workerId !== workerId) return res.status(404).json({ error: "not found" });
    await deletePendingSignature(surveyId, token);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ===========================
 * Manager-facing — no login. The token itself (a random 24-char hex
 * string) is the only credential; treat it like a capability URL.
 * =========================== */

/**
 * GET /public/surveys/:surveyId/pending-signatures/:token
 * Returns just enough to render the manager's confirmation screen — not
 * the whole formSnapshot verbatim, to avoid handing out more than what's
 * already on the printed work log itself.
 */
r.get("/public/surveys/:surveyId/pending-signatures/:token", async (req: Request, res: Response) => {
  try {
    const { surveyId, token } = req.params as any;
    const item = await getPendingSignature(surveyId, token);
    if (!item) return res.status(404).json({ error: "not found" });
    if (item.expiresAt && Date.now() > item.expiresAt) {
      return res.status(410).json({ error: "expired" });
    }

    const f = item.formSnapshot || {};
    res.json({
      ok: true,
      status: item.status,
      summary: {
        isPrivate: !!f.isPrivate,
        company: f.company,
        project: f.project,
        privateClientName: f.privateClientName,
        manager: f.manager,
        teamLead: f.teamLead,
        helper1: f.helper1,
        helper2: f.helper2,
        date: f.date,
        dayType: f.dayType,
        workDesc: f.workDesc,
        notes: f.notes,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /public/surveys/:surveyId/pending-signatures/:token/sign
 * body: { sigManager: [...strokes], sigMeta?: {...} }
 */
r.post("/public/surveys/:surveyId/pending-signatures/:token/sign", async (req: Request, res: Response) => {
  try {
    const { surveyId, token } = req.params as any;
    const { sigManager, sigMeta } = req.body || {};
    if (!Array.isArray(sigManager) || sigManager.length === 0) {
      return res.status(400).json({ error: "sigManager required" });
    }

    const item = await getPendingSignature(surveyId, token);
    if (!item) return res.status(404).json({ error: "not found" });
    if (item.expiresAt && Date.now() > item.expiresAt) {
      return res.status(410).json({ error: "expired" });
    }

    const result = await signPendingSignature(surveyId, token, sigManager, sigMeta);
    if (result?.alreadySigned) {
      return res.status(409).json({ error: "already signed" });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
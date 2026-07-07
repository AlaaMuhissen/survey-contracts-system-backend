import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export function requireInvite(req: Request, res: Response, next: NextFunction) {
  const raw =
    (req.query.t as string) ||
    (req.headers.authorization || "").replace("Bearer ", "");

  if (!raw) return res.status(401).json({ error: "no_invite" });

  try {
    const payload = jwt.verify(raw, process.env.JWT_INVITE_SECRET as string) as any;
    if (payload.scope !== "submit:form") return res.status(403).json({ error: "bad_scope" });
    (req as any).formAuth = payload; // { orgId, formId, scope }
    next();
  } catch {
    res.status(401).json({ error: "bad_invite" });
  }
}

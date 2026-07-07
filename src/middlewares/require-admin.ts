// src/middlewares/require-admin.ts
import { Request, Response, NextFunction } from "express";

/** Survey-level admin only (plus superadmin) */
export function requireSurveyAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.authUser?.claims.role;
  if (role === "superadmin" || role === "survey_admin") return next();
  return res.status(403).json({ error: "Survey admin only" });
}

/** Contractor-level admin (plus survey_admin and superadmin) */
export function requireContractorAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.authUser?.claims.role;
  if (role === "superadmin" || role === "survey_admin" || role === "contractor_admin") return next();
  return res.status(403).json({ error: "Contractor admin only" });
}

// src/middlewares/requireTenant.ts
import { Request, Response, NextFunction } from "express";

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const claims = req.authUser?.claims || {};
  const role = claims.role;
  const tokenSurvey = claims.surveyId;

  const routeSurvey = req.params.surveyId as string | undefined;
  const routeCompany = req.params.companyId as string | undefined;

  // Superadmin bypass
  if (role === "superadmin") return next();

  // Require survey match
  if (!routeSurvey || !tokenSurvey || routeSurvey !== tokenSurvey) {
    return res.status(403).json({ error: "Survey mismatch" });
  }

  // If company-scoped route:
  if (routeCompany) {
    // Survey staff can access any company in their survey
    if (role?.startsWith("survey_")) return next();
    // Contractor staff must match their own company
  }

  return next();
}

// src/types/express.d.ts
import "express";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        uid: string;
        email?: string;
        claims: {
          surveyId?: string;
          companyId?: string;
          role?:
            | "superadmin"
            | "survey_admin"
            | "survey_viewer"
            | "contractor_admin"
            | "worker"
            | "viewer";
        };
      };
    }
  }
}

export {};

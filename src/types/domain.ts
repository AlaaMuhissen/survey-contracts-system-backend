// src/utils/domain.ts

export type Role =
  | "superadmin"
  | "survey_admin"
  | "survey_viewer"
  | "contractor_admin"
  | "worker"
  | "viewer";

export interface Survey {
  id: string;
  name: string;
  nameLower: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface Company { // contractor
  id: string;
  name: string;
  nameLower: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  nameLower: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface Contract {
  id: string;
  companyId: string;
  title?: string;
  supabasePath?: string;
  status?: "draft" | "active" | "archived";
  createdAt?: any;
  updatedAt?: any;
}

export interface Submission {
  id: string;
  companyId: string;
  contractId: string;
  workerId: string;
  signedAt?: any;
  status?: "pending" | "approved" | "rejected";
  createdAt?: any;
  updatedAt?: any;
}

export interface WorkLog {
  id: string;
  message: string;
  level: "info" | "warn" | "error";
  by?: string | null;
  createdAt?: any;
}

export interface SurveyUser {
  id: string;
  username?: string;
  email?: string;
  role: Role;
  createdAt?: any;
}

export interface ContractorUser extends SurveyUser {
  companyId: string;
}

/** Path helpers (string-only), mirrors src/utils/paths.ts runtime helpers */
export const dpaths = {
  survey: (s: string) => `surveys/${s}`,
  companies: (s: string) => `surveys/${s}/companies`,
  company: (s: string, c: string) => `surveys/${s}/companies/${c}`,
  companyProjects: (s: string, c: string) => `surveys/${s}/companies/${c}/projects`,
  companyContracts: (s: string, c: string) => `surveys/${s}/companies/${c}/contracts`,
  companySubmissions: (s: string, c: string) => `surveys/${s}/companies/${c}/submissions`,
  surveyUsers: (s: string) => `surveys/${s}/users`,
  companyUsers: (s: string, c: string) => `surveys/${s}/companies/${c}/users`,
  workLogs: (s: string) => `surveys/${s}/workLogs`,
  config: (s: string) => `surveys/${s}/config`,
  counters: (s: string) => `surveys/${s}/counters`,
};

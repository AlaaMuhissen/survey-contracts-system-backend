// src/utils/paths.ts
/** Centralized Firestore path builders for the multi-survey structure. */
export const paths = {
  // Survey-level
  survey: (surveyId: string) => `surveys/${surveyId}`,
  companies: (surveyId: string) => `surveys/${surveyId}/companies`,
  workLogs: (surveyId: string) => `surveys/${surveyId}/workLogs`,
  users: (surveyId: string) => `surveys/${surveyId}/users`,
  workers: (surveyId: string) => `surveys/${surveyId}/workers`,
  config: (surveyId: string) => `surveys/${surveyId}/config`,
  counters: (surveyId: string) => `surveys/${surveyId}/counters`,
  projectsIndex: (surveyId: string) => `surveys/${surveyId}/projects`,
  privateClients: (surveyId: string) => `surveys/${surveyId}/privateClients`,
  privateClient: (surveyId: string, privateClientId: string) =>
    `surveys/${surveyId}/privateClients/${privateClientId}`,
 
  // Company-level 
  company: (surveyId: string, companyId: string) =>
    `surveys/${surveyId}/companies/${companyId}`,
  companyProjects: (surveyId: string, companyId: string) =>
    `surveys/${surveyId}/companies/${companyId}/projects`,
  companyProject: (surveyId: string, companyId: string, projectId: string) =>
    `surveys/${surveyId}/companies/${companyId}/projects/${projectId}`,
  companyContracts: (surveyId: string, companyId: string) =>
    `surveys/${surveyId}/companies/${companyId}/contracts`,
  companyUsers: (surveyId: string, companyId: string) =>
    `surveys/${surveyId}/companies/${companyId}/users`,
  companySubmissions: (surveyId: string, companyId: string) =>
    `surveys/${surveyId}/companies/${companyId}/submissions`,
 

  // Shortcuts
  projects: (surveyId: string) => `surveys/${surveyId}/projects`,

  contracts: (surveyId: string) => `surveys/${surveyId}/contracts`,
  submissions: (surveyId: string) => `surveys/${surveyId}/submissions`,
};


/** Example usage:
 * db.collection(paths.companies(surveyId))
 * db.doc(paths.company(surveyId, companyId))
 */

// src/services/projects.service.ts
import { db, serverTimestamp } from "../lib/firebase";
import { paths } from "../utils/paths";

function projectsColPath(surveyId: string, companyId: string) {
  return `${paths.company(surveyId, companyId)}/projects`;
}

export async function listProjects(surveyId: string, companyId: string) {
  const snap = await db.collection(projectsColPath(surveyId, companyId))
    .orderBy("nameLower", "asc")
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getProject(surveyId: string, companyId: string, projectId: string) {
  const doc = await db.doc(`${projectsColPath(surveyId, companyId)}/${projectId}`).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createProject(surveyId: string, companyId: string, data: { name: string }) {
  const col = db.collection(projectsColPath(surveyId, companyId));
  const ref = col.doc();
  const payload = {
    name: data.name,
    nameLower: data.name.toLowerCase(),
    createdAt: serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function updateProject(surveyId: string, companyId: string, projectId: string, data: Partial<{ name: string }>) {
  const ref = db.doc(`${projectsColPath(surveyId, companyId)}/${projectId}`);
  const patch: any = { updatedAt: serverTimestamp() };
  if (typeof data.name === "string") {
    patch.name = data.name;
    patch.nameLower = data.name.toLowerCase();
  }
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

export async function deleteProject(surveyId: string, companyId: string, projectId: string) {
  await db.doc(`${projectsColPath(surveyId, companyId)}/${projectId}`).delete();
  return { ok: true };
}

// src/services/companies.service.ts
import { db, serverTimestamp } from "../lib/firebase";
import { paths } from "../utils/paths";

export async function listCompanies(surveyId: string) {
  const snap = await db.collection(paths.companies(surveyId))
    .orderBy("nameLower", "asc")
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getCompany(surveyId: string, companyId: string) {
  const doc = await db.doc(paths.company(surveyId, companyId)).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createCompany(surveyId: string, data: { name: string }) {
  const col = db.collection(paths.companies(surveyId));
  const ref = col.doc();
  const payload = {
    name: data.name,
    nameLower: data.name.toLowerCase(),
    createdAt: serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function updateCompany(surveyId: string, companyId: string, data: Partial<{ name: string }>) {
  const ref = db.doc(paths.company(surveyId, companyId));
  const patch: any = { updatedAt: serverTimestamp() };
  if (typeof data.name === "string") {
    patch.name = data.name;
    patch.nameLower = data.name.toLowerCase();
  }
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

export async function deleteCompany(surveyId: string, companyId: string) {
  // NOTE: this only deletes the company doc (NOT its subcollections).
  await db.doc(paths.company(surveyId, companyId)).delete();
  return { ok: true };
}

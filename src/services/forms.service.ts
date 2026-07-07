// src/services/forms.service.ts
import { db, serverTimestamp } from "../lib/firebase";
import { paths } from "../utils/paths";

function formsColPath(surveyId: string, companyId: string) {
  return `${paths.company(surveyId, companyId)}/forms`;
}

export async function listForms(surveyId: string, companyId: string) {
  const snap = await db.collection(formsColPath(surveyId, companyId))
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getForm(surveyId: string, companyId: string, formId: string) {
  const doc = await db.doc(`${formsColPath(surveyId, companyId)}/${formId}`).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createForm(surveyId: string, companyId: string, data: any) {
  const col = db.collection(formsColPath(surveyId, companyId));
  const ref = col.doc();
  const payload = { ...data, createdAt: serverTimestamp() };
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function updateForm(surveyId: string, companyId: string, formId: string, data: any) {
  const ref = db.doc(`${formsColPath(surveyId, companyId)}/${formId}`);
  await ref.set({ ...data, updatedAt: serverTimestamp() }, { merge: true });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

export async function deleteForm(surveyId: string, companyId: string, formId: string) {
  await db.doc(`${formsColPath(surveyId, companyId)}/${formId}`).delete();
  return { ok: true };
}

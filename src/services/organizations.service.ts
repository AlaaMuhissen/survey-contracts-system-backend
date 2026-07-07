// src/services/organizations.service.ts
import { db, serverTimestamp } from "../lib/firebase";

export async function getSurvey(surveyId: string) {
  const doc = await db.doc(`surveys/${surveyId}`).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createSurvey(name: string) {
  const ref = db.collection("surveys").doc();
  const payload = {
    name,
    nameLower: name.toLowerCase(),
    createdAt: serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function updateSurvey(surveyId: string, data: Partial<{ name: string }>) {
  const ref = db.doc(`surveys/${surveyId}`);
  const patch: any = { updatedAt: serverTimestamp() };
  if (typeof data.name === "string") {
    patch.name = data.name;
    patch.nameLower = data.name.toLowerCase();
  }
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

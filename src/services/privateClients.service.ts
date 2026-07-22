import { db, serverTimestamp } from "../lib/firebase";
import { paths } from "../utils/paths";

export async function listPrivateClients(surveyId: string) {
  const snap = await db.collection(paths.privateClients(surveyId))
    .orderBy("nameLower", "asc")
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPrivateClient(surveyId: string, privateClientId: string) {
  const doc = await db.doc(paths.privateClient(surveyId, privateClientId)).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createPrivateClient(
  surveyId: string,
  data: { name: string; price?: number }
) {
  const col = db.collection(paths.privateClients(surveyId));
  const ref = col.doc();
  const payload: any = {
    name: data.name,
    nameLower: data.name.toLowerCase(),
    active: true,
    createdAt: serverTimestamp(),
  };
  if (typeof data.price === "number") payload.price = data.price;
  await ref.set(payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function updatePrivateClient(
  surveyId: string,
  privateClientId: string,
  data: Partial<{ name: string; price: number; active: boolean }>
) {
  const ref = db.doc(paths.privateClient(surveyId, privateClientId));
  const patch: any = { updatedAt: serverTimestamp() };
  if (typeof data.name === "string") {
    patch.name = data.name;
    patch.nameLower = data.name.toLowerCase();
  }
  if (typeof data.price === "number") patch.price = data.price;
  if (typeof data.active === "boolean") patch.active = data.active;
  await ref.set(patch, { merge: true });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

export async function deletePrivateClient(surveyId: string, privateClientId: string) {
  await db.doc(paths.privateClient(surveyId, privateClientId)).delete();
  return { ok: true };
}

import { db, FieldValue } from "@lib/firebase.js";

export async function createProject(params: { name: string; companyId: string }) {
  const name = String(params.name || "").trim();
  const companyId = String(params.companyId || "").trim();
  if (!name || !companyId) throw new Error("Missing name/companyId");

  const company = await db.collection("companies").doc(companyId).get();
  if (!company.exists) throw new Error("Company not found");
  const companyName = (company.data() as any).name;

  const doc = await db.collection("projects").add({
    name,
    nameLower: name.toLowerCase(),
    companyId,
    companyName,
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, id: doc.id, name, companyId, companyName };
}

export async function listProjects(companyId?: string) {
  const col = db.collection("projects");
  const snap = companyId
    ? await col.where("companyId", "==", companyId).get()
    : await col.get();

  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { items };
}

export async function patchProject(id: string, patchIn: { isActive?: boolean; name?: string }) {
  const patch: any = {};
  if (typeof patchIn.isActive === "boolean") patch.isActive = patchIn.isActive;
  if (patchIn.name) {
    patch.name = String(patchIn.name).trim();
    patch.nameLower = patch.name.toLowerCase();
  }
  if (!Object.keys(patch).length) throw new Error("Nothing to update");

  await db.collection("projects").doc(id).set(patch, { merge: true });
  return { ok: true };
}

export async function deleteProject(id: string) {
  await db.collection("projects").doc(id).delete();
  return { ok: true };
}

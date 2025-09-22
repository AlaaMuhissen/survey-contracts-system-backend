import { db, FieldValue } from "@lib/firebase.js";

/** Create a company */
export async function createCompany(name: string) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Missing company name");

  const doc = await db.collection("companies").add({
    name: trimmed,
    nameLower: trimmed.toLowerCase(),
    createdAt: FieldValue.serverTimestamp(),
  });

  return { id: doc.id, name: trimmed };
}

/** List companies (desc by createdAt) with optional client-side text filter */
export async function listCompanies(limit = 50, qText?: string) {
  const lim = Math.min(100, Number(limit || 50));
  let q = db.collection("companies").orderBy("createdAt", "desc").limit(lim);

  const snap = await q.get();
  let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const needle = String(qText || "").trim().toLowerCase();
  if (needle) items = items.filter((c) => c.nameLower?.includes(needle));

  return { items };
}

/** Delete company and its projects in chunks */
export async function deleteCompanyAndProjects(companyId: string) {
  const id = String(companyId || "").trim();
  if (!id) throw new Error("Missing company id");

  const projSnap = await db.collection("projects").where("companyId", "==", id).get();

  let batch = db.batch();
  let ops = 0;

  for (const doc of projSnap.docs) {
    batch.delete(doc.ref);
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await db.collection("companies").doc(id).delete();

  return { ok: true, deletedProjects: projSnap.size, companyId: id };
}

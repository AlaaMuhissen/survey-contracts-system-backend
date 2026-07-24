import crypto from "crypto";
import { db, FieldValue } from "../lib/firebase";
import { paths } from "../utils/paths";

const EXPIRY_MS = 1000 * 60 * 60 * 48; // 48h — link stops working after this

// Firestore rejects arrays that directly contain other arrays — and a
// signature (Stroke[] = Point[][]) is exactly that. formSnapshot is stored
// as JSON too, defensively, since nothing ever queries into these fields
// and it's one less structural constraint to worry about as the form shape
// evolves.
function toJson(value: any): string {
  return JSON.stringify(value ?? null);
}
function fromJson(value: any): any {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hydrate(doc: Record<string, any>): any {
  return {
    ...doc,
    formSnapshot: fromJson(doc.formSnapshotJson) ?? {},
    sigLead: fromJson(doc.sigLeadJson) ?? [],
    sigManager: fromJson(doc.sigManagerJson) ?? null,
  };
}

export async function createPendingSignature(surveyId: string, data: {
  workerId: string;
  formSnapshot: Record<string, any>; // the worker's full form at send-time
  sigLead?: any[];                   // team-lead signature, already drawn
  sigMeta?: any;
}) {
  const token = crypto.randomBytes(12).toString("hex");
  const ref = db.doc(paths.pendingSignature(surveyId, token));
  await ref.set(
    {
      workerId: data.workerId,
      formSnapshotJson: toJson(data.formSnapshot),
      sigLeadJson: toJson(data.sigLead || []),
      sigMeta: data.sigMeta || null, // plain {w,h} object — no arrays, safe as-is
      sigManagerJson: toJson(null),
      status: "pending", // "pending" | "signed"
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Date.now() + EXPIRY_MS,
    },
    { merge: true }
  );
  return token;
}

export async function getPendingSignature(surveyId: string, token: string) {
  const snap = await db.doc(paths.pendingSignature(surveyId, token)).get();
  if (!snap.exists) return null;
  return hydrate({ id: snap.id, ...snap.data() });
}

export async function signPendingSignature(
  surveyId: string,
  token: string,
  sigManager: any[],
  sigMeta?: any
) {
  const ref = db.doc(paths.pendingSignature(surveyId, token));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (data.status === "signed") return { alreadySigned: true };
  await ref.set(
    {
      sigManagerJson: toJson(sigManager),
      ...(sigMeta ? { sigMeta } : {}),
      status: "signed",
      signedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { alreadySigned: false };
}

export async function listPendingSignatures(surveyId: string, workerId: string) {
  // Sorted in JS rather than via Firestore orderBy — combining a where()
  // filter with orderBy() on a different field requires a composite index
  // to be created manually in the Firebase console; this avoids that
  // entirely for what's a small, bounded list (limit 50) anyway.
  const snap = await db
    .collection(paths.pendingSignatures(surveyId))
    .where("workerId", "==", workerId)
    .limit(50)
    .get();
  const items = snap.docs.map((d) => hydrate({ id: d.id, ...d.data() }));
  items.sort((a, b) => {
    const at = a.createdAt?._seconds ?? a.createdAt?.seconds ?? 0;
    const bt = b.createdAt?._seconds ?? b.createdAt?.seconds ?? 0;
    return bt - at; // newest first
  });
  return items;
}

export async function deletePendingSignature(surveyId: string, token: string) {
  await db.doc(paths.pendingSignature(surveyId, token)).delete();
}
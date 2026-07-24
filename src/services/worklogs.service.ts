import { db, FieldValue } from "@lib/firebase.js";
import { uploadPdfBuffer } from "@lib/cloudinary.js";
import { paths } from "../utils/paths";

/** Types that match your domain */
export type SerialOptions = { width?: number };
export type WorklogMeta = Record<string, any>;

export function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

/** Firestore counter → next padded serial ("00001" etc.) for this SURVEY */
export async function getNextSerial(
  surveyId: string,
  opts: SerialOptions = {}
) {
  const { width = 5 } = opts;
  const ref = db.doc(`${paths.counters(surveyId)}/workLogs`);

  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let n: number;
    if (!snap.exists) {
      n = 1;
      tx.set(ref, { seq: n, updatedAt: FieldValue.serverTimestamp() });
    } else {
      const current = Number(snap.data()?.seq ?? 0);
      n = current + 1;
      tx.update(ref, { seq: n, updatedAt: FieldValue.serverTimestamp() });
    }
    return n;
  });

  const serial = String(next).padStart(width, "0");
  return { seq: next, serial };
}

/** Ensure a provided serial isn't already used within THIS SURVEY (check only — see claimSerial for the race-safe version) */
export async function assertSerialAvailable(surveyId: string, serial: string) {
  const doc = await db.doc(`${paths.workLogs(surveyId)}/${serial}`).get();
  if (doc.exists) {
    const err: any = new Error("Serial already used");
    err.code = "SERIAL_TAKEN";
    err.serial = serial;
    throw err;
  }
}

/**
 * Atomically claim a serial number BEFORE doing any slow work (PDF
 * generation, Cloudinary upload, etc).
 *
 * Why this exists: `assertSerialAvailable` alone is a check-then-act race —
 * if two requests for the same serial both pass the check before either has
 * finished its slow upload and written the doc, BOTH proceed and BOTH
 * succeed, producing a duplicate write. This happens in practice when a
 * client-side request appears to fail (dropped connection, timeout) while
 * the server is still processing it, and the client retries with the same
 * reserved number.
 *
 * `claimSerial` closes that gap: it's a Firestore transaction that checks
 * AND writes a placeholder doc in one atomic step, before the slow work
 * starts. The second concurrent caller sees the placeholder and is rejected
 * in milliseconds — no wasted upload, no duplicate.
 */
export async function claimSerial(surveyId: string, serial: string) {
  const ref = db.doc(`${paths.workLogs(surveyId)}/${serial}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const err: any = new Error("Serial already used");
      err.code = "SERIAL_TAKEN";
      err.serial = serial;
      throw err;
    }
    tx.set(ref, {
      number: serial,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * A worker submitting a "private service" work log may type a brand-new
 * client name (no privateClientId yet) or pick an existing one from the
 * dropdown. Either way, by the time the log is saved there needs to be a
 * real `privateClients` doc for the admin to later attach a price to —
 * nothing else creates one. This resolves the id if given, or finds/creates
 * a doc by name (case-insensitive) to avoid duplicate entries when the same
 * new client is typed more than once before the worker app's cache catches
 * up (e.g. offline queue draining out of order).
 */
export async function resolveOrCreatePrivateClient(
  surveyId: string,
  params: { privateClientId?: string; privateClientName?: string }
): Promise<string | null> {
  const { privateClientId, privateClientName } = params;
  const name = String(privateClientName || "").trim();

  if (privateClientId) {
    const ref = db.doc(paths.privateClient(surveyId, privateClientId));
    const snap = await ref.get();
    if (snap.exists) return privateClientId;
    // stale/deleted id — fall through and resolve by name instead
  }

  if (!name) return privateClientId || null;

  const nameLower = name.toLowerCase();
  const col = db.collection(paths.privateClients(surveyId));
  const existing = await col.where("nameLower", "==", nameLower).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;

  const ref = col.doc();
  await ref.set(
    { name, nameLower, active: true, createdAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return ref.id;
}

/** Upload a base64 data URL PDF to Cloudinary and write Firestore doc (scoped to survey) */
export async function uploadWorklogPdf(params: {
  companyId: string;
  projectId: string;
  surveyId: string;
  meta: WorklogMeta;
  pdfBase64: string;
  serial?: string;          // if client reserved a number
  seq?: number | undefined; // optional: keep seq alongside number
  width?: number;           // fallback width for server-side allocation
  workerId?: string;        // stamped from the authenticated worker's JWT
}) {
  const { companyId, projectId, surveyId, meta = {}, pdfBase64, serial, seq, width = 5, workerId } = params;
  if (!pdfBase64) throw new Error("Missing pdfBase64");
  if (workerId) meta.workerId = workerId;

  // "private" companyId is the worker app's placeholder for private-service
  // logs (see frontend saveToFirebase.ts) — it's only a URL route param,
  // never part of the submitted form/meta (the worker form clears
  // form.companyId on mode switch), so without this the persisted doc's
  // companyId field would stay "" and reports/filters keyed on it would
  // silently drop the row. Stamp it onto meta so the doc is self-consistent.
  let effectiveProjectId = projectId;
  if (companyId === "private") {
    const resolvedId = await resolveOrCreatePrivateClient(surveyId, {
      privateClientId: meta.privateClientId,
      privateClientName: meta.privateClientName,
    });
    if (resolvedId) {
      effectiveProjectId = resolvedId;
      meta.privateClientId = resolvedId;
      meta.projectId = resolvedId;
    }
    meta.companyId = "private";
    meta.isPrivate = true;
  }

  let number = serial;
  let effectiveSeq = seq;

  if (number) {
    // Atomically claim this exact serial NOW, before the slow PDF/upload
    // work starts — closes the race a plain check-then-act would leave open.
    await claimSerial(surveyId, number);
  } else {
    const nxt = await getNextSerial(surveyId, { width })
    number = nxt.serial;
    effectiveSeq = nxt.seq;
    // Freshly allocated from an atomic counter, so it's already unique in
    // practice — claim it anyway as a cheap defensive measure.
    await claimSerial(surveyId, number);
  }

  const id = number!;
  const { buffer } = dataUrlToBuffer(String(pdfBase64));

  // Same nested namespace you used in your Supabase bucket — Cloudinary
  // treats "/" as virtual folders, so this keeps the exact same organization.
  const objectPath = `surveys/${surveyId}/companies/${companyId}/projects/${effectiveProjectId}/workLogs/${id}.pdf`;

  let fileUrl: string;
  let cloudinaryPublicId: string;
  try {
    const result = await uploadPdfBuffer(buffer, objectPath);
    fileUrl = result.secure_url;
    cloudinaryPublicId = result.public_id;
  } catch (err: any) {
    // Upload failed after we claimed the serial — release the placeholder
    // so this number isn't burned forever and can be retried.
    await db.doc(`${paths.workLogs(surveyId)}/${id}`).delete().catch(() => {});
    throw new Error(`Storage upload failed: ${err?.message ?? "unknown error"}`);
  }

  if ("seq" in meta && meta.seq === undefined) delete (meta as any).seq;

  const payload: any = {
    ...meta,
    number: id,
    status: "complete",
    storage: "cloudinary-public",
    storageKey: cloudinaryPublicId,
    fileUrl,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (typeof effectiveSeq === "number" && Number.isFinite(effectiveSeq)) {
    payload.seq = effectiveSeq;
  }

  await db.doc(`${paths.workLogs(surveyId)}/${id}`).set(payload, { merge: true });

  return { id, number: id, seq: effectiveSeq ?? null, fileUrl };
}

/** Paginated list with optional prefix search on `number` (per SURVEY) */
export async function listWorklogs(params: {
  surveyId: string;
  limit?: number;
  cursorMs?: number | null;
  q?: string | null;
}) {
  const { surveyId, limit = 25, cursorMs = null, q = null } = params;

  let qry: FirebaseFirestore.Query = db
    .collection(paths.workLogs(surveyId))
    .orderBy("createdAt", "desc");

  if (q) {
    // If you want to query by number prefix, ensure `number` is a string field
    qry = qry.where("number", ">=", q).where("number", "<=", q + "\uf8ff");
  }

  if (cursorMs) {
    qry = qry.startAfter(new Date(cursorMs));
  }

  const snap = await qry.limit(limit).get();
  const items = snap.docs
    .map((d) => {
      const data = d.data() as any;
      const ms = data.createdAt?.toMillis?.() ?? null;
      return {
        id: d.id,
        ...data,
        createdAtMs: ms,
        createdAtISO: ms ? new Date(ms).toISOString() : null,
      };
    })
    // Exclude transient "pending" placeholders (mid-upload, no fileUrl yet).
    // Legacy docs written before this field existed have no `status` at
    // all — `!== "pending"` naturally keeps those, only "pending" is hidden.
    .filter((item: any) => item.status !== "pending");

  const last = items[items.length - 1];
  const nextCursor = last?.createdAtMs ? Number(last.createdAtMs) : null;

  return { items, nextCursor };
}
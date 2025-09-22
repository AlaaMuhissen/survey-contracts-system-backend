import { db, FieldValue, Timestamp } from "@lib/firebase.js";
import { supabase, SUPABASE_BUCKET } from "@lib/supabase.js";

/** Types that match your domain */
export type SerialOptions = { width?: number };
export type WorklogMeta = Record<string, any>;

export function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

/** Firestore counter → next padded serial ("00001" etc.) */
export async function getNextSerial(opts: SerialOptions = {}) {
  const { width = 5 } = opts;
  const ref = db.collection("counters").doc("workLogs");

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

/** Ensure a provided serial isn’t already used */
export async function assertSerialAvailable(serial: string) {
  const doc = await db.collection("workLogs").doc(serial).get();
  if (doc.exists) {
    const err: any = new Error("Serial already used");
    err.code = "SERIAL_TAKEN";
    err.serial = serial;
    throw err;
  }
}

/** Upload a base64 data URL PDF to Supabase and write Firestore doc. */
export async function uploadWorklogPdf(
  params: {
    meta: WorklogMeta;
    pdfBase64: string;
    serial?: string;          // if client reserved a number
    seq?: number | undefined; // optional for keeping seq alongside number
    width?: number;           // fallback width for server-side allocation
  }
) {
  const { meta = {}, pdfBase64, serial, seq, width = 5 } = params;
  if (!pdfBase64) throw new Error("Missing pdfBase64");

  let number = serial;
  let effectiveSeq = seq;

  if (number) {
    await assertSerialAvailable(number);
  } else {
    const nxt = await getNextSerial({ width });
    number = nxt.serial;
    effectiveSeq = nxt.seq;
  }

  const id = number!;
  const { buffer, contentType } = dataUrlToBuffer(String(pdfBase64));
  const objectPath = `${id}.pdf`;

  // upload (upsert true → matches current behavior)
  const upload = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(objectPath, buffer, {
      contentType: contentType || "application/pdf",
      upsert: true,
    });

  if (upload.error) {
    throw new Error(`Storage upload failed: ${upload.error.message}`);
  }

  const signed = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);

  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("Could not create file URL");
  }

  const fileUrl = signed.data.signedUrl;

  const payload: any = {
    ...meta,
    number: id,
    storage: "supabase-private",
    storageKey: `${SUPABASE_BUCKET}/${objectPath}`,
    fileUrl,
    createdAt: FieldValue.serverTimestamp(),
  };
  if (typeof effectiveSeq === "number") payload.seq = effectiveSeq;

  await db.collection("workLogs").doc(id).set(payload);

  return { id, number: id, seq: effectiveSeq ?? null, fileUrl };
}

/** Paginated list with optional prefix search on `number` */
export async function listWorklogs(params: {
  limit?: number;
  cursorMs?: number | null;
  q?: string | null;
}) {
  const { limit = 25, cursorMs = null, q = null } = params;

  let qry: FirebaseFirestore.Query = db
    .collection("workLogs")
    .orderBy("createdAt", "desc");

  if (q) {
    qry = qry.where("number", ">=", q).where("number", "<=", q + "\uf8ff");
  }
  if (cursorMs) {
    qry = qry.startAfter(new Date(cursorMs));
  }

  const snap = await qry.limit(limit).get();
  const items = snap.docs.map((d) => {
    const data = d.data() as any;
    const ms = data.createdAt?.toMillis?.() ?? null;
    return {
      id: d.id,
      ...data,
      createdAtMs: ms,
      createdAtISO: ms ? new Date(ms).toISOString() : null,
    };
  });

  const last = items[items.length - 1];
  const nextCursor = last?.createdAtMs ? Number(last.createdAtMs) : null;

  return { items, nextCursor };
}

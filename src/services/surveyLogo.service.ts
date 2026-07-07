import { uploadPdfBuffer } from "@lib/cloudinary";
import { assertSerialAvailable, dataUrlToBuffer, getNextSerial, WorklogMeta } from "./worklogs.service";
import { db, FieldValue } from "@lib/firebase";
import { paths } from "@utils/paths";




/** Upload a base64 data URL PDF to Cloudinary and write Firestore doc (scoped to survey) */
export async function uploadSurveyLogo(params: {
  surveyId: string;
  pdfBase64: string;
  serial?: string;          // if client reserved a number
  seq?: number | undefined; // optional: keep seq alongside number
  width?: number;           // fallback width for server-side allocation
}) {
  const { surveyId, pdfBase64, serial, seq, width = 5 } = params;
  if (!pdfBase64) throw new Error("Missing pdfBase64");

  let number = serial;
  let effectiveSeq = seq;

  if (number) {
    await assertSerialAvailable(surveyId, number);
  } else {
    const nxt = await getNextSerial(surveyId, { width });
    number = nxt.serial;
    effectiveSeq = nxt.seq;
  }

  const id = number!;
  const { buffer } = dataUrlToBuffer(String(pdfBase64));

  // Same nested namespace you used in your Supabase bucket.
  const objectPath = `surveys/${surveyId}/Logo/${id}.pdf`;

  let fileUrl: string;
  let cloudinaryPublicId: string;
  try {
    const result = await uploadPdfBuffer(buffer, objectPath);
    fileUrl = result.secure_url;
    cloudinaryPublicId = result.public_id;
  } catch (err: any) {
    throw new Error(`Storage upload failed: ${err?.message ?? "unknown error"}`);
  }

  const payload: any = {
    number: id,
    seq: typeof effectiveSeq === "number" ? effectiveSeq : undefined,
    storage: "cloudinary-public",
    storageKey: cloudinaryPublicId,
    fileUrl,
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.doc(`${paths.workLogs(surveyId)}/${id}`).set(payload, { merge: true });

  return { id, number: id, seq: effectiveSeq ?? null, fileUrl };
}
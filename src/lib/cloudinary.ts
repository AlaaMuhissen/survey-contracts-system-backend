import { v2 as cloudinary } from "cloudinary";

// helper that throws if missing AND narrows the type to `string`
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v; // <- typed as `string`
}

export const CLOUDINARY_CLOUD_NAME = requireEnv("CLOUDINARY_CLOUD_NAME");
export const CLOUDINARY_API_KEY = requireEnv("CLOUDINARY_API_KEY");
export const CLOUDINARY_API_SECRET = requireEnv("CLOUDINARY_API_SECRET");
// Equivalent to SUPABASE_BUCKET — just a folder prefix inside your Cloudinary account.
export const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER ?? "Contracts";

let _configured = false;
export function getCloudinary() {
  if (_configured) return cloudinary;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  _configured = true;
  return cloudinary;
}

export function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

/**
 * Generic upload — raw for PDFs/documents, image for logos/pictures.
 * `objectPath` is the FULL path (no leading slash), e.g.
 * "surveys/{surveyId}/companies/{companyId}/contracts/{contractId}.pdf"
 * Cloudinary treats "/" in public_id as virtual folders, so this preserves
 * the same nested organization you had in your Supabase bucket paths.
 */
async function uploadBuffer(
  buffer: Buffer,
  objectPath: string,
  resourceType: "raw" | "image" = "raw"
) {
  const cld = getCloudinary();
  return new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: CLOUDINARY_FOLDER,
        public_id: objectPath,
        use_filename: false,
        unique_filename: false,
        overwrite: true, // matches Supabase's upsert: true
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/** Upload a PDF buffer to Cloudinary as a raw asset. */
export async function uploadPdfBuffer(buffer: Buffer, objectPath: string) {
  return uploadBuffer(buffer, objectPath, "raw");
}

/** Upload an image buffer (logos, branding) to Cloudinary. */
export async function uploadImageBuffer(buffer: Buffer, objectPath: string) {
  return uploadBuffer(buffer, objectPath, "image");
}

/** Upload from a raw (no "data:...;base64," prefix) base64 string — matches old uploadBase64(). */
export async function uploadBase64Pdf(
  objectPath: string,
  fileBase64: string,
  _contentType = "application/pdf"
) {
  const buffer = Buffer.from(fileBase64, "base64");
  return uploadPdfBuffer(buffer, objectPath);
}

/** Same canonical contract PDF path you used for Supabase. */
export function buildContractPdfPath(
  surveyId: string,
  companyId: string,
  contractId: string
) {
  return `surveys/${surveyId}/companies/${companyId}/contracts/${contractId}.pdf`;
}

/**
 * Look up the delivery URL for an already-uploaded asset, given the FULL
 * public_id returned at upload time (i.e. what you stored in Firestore).
 * This is a pure URL construction — no network call — same role as
 * Supabase's getPublicUrl().
 */
export function getFileUrl(fullPublicId: string, resourceType: "raw" | "image" = "raw") {
  const cld = getCloudinary();
  return cld.url(fullPublicId, {
    resource_type: resourceType,
    type: "upload",
    secure: true,
  });
}
// src/lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "stream";

// helper that throws if missing AND narrows the type to `string`
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
// Keep your existing name; DO NOT rename to *_KEY unless you also change .env
export const SUPABASE_SERVICE_ROLE = requireEnv("SUPABASE_SERVICE_ROLE");
// Keep your existing default (bucket name must match your dashboard)
export const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "Contracts";

let _client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "worklogs-backend" } },
  });
  return _client;
}

export const supabase = getSupabase();



export function getPublicUrl(objectPath: string) {
  const { data } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(objectPath);

  return data.publicUrl;
}

/** Convert data URL (base64) to buffer (unchanged) */
export function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

/** 🔑 NEW: build the canonical PDF path in Supabase for the new layout */
export function buildContractPdfPath(
  surveyId: string,
  companyId: string,
  contractId: string
) {
  
  // surveys/{surveyId}/companies/{companyId}/contracts/{contractId}.pdf
  return `surveys/${surveyId}/companies/${companyId}/contracts/${contractId}.pdf`;
}
export function buildLogoPath(
  surveyId: string
) {
  // surveys/{surveyId}/logos/{logoId}.png
  return `surveys/${surveyId}/logos/{logoId}.png`;
}


/** 🔑 NEW: convenience upload helper for base64 strings */
export async function uploadBase64(
  objectPath: string,
  fileBase64: string,
  contentType = "application/pdf"
) {
  const buffer = Buffer.from(fileBase64, "base64");
  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(objectPath, buffer, { upsert: true, contentType });
  if (error) throw error;
}


export async function getWorklogPdfStream({ pdfPath }: { pdfPath: string }) {
  
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(pdfPath);
  if (error) throw error;

  // data is a Blob in many environments; convert to Buffer
  const arr = new Uint8Array(await data.arrayBuffer());
  const buf = Buffer.from(arr);

  return Readable.from(buf);
}
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// helper that throws if missing AND narrows the type to `string`
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v; // <- typed as `string`
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE = requireEnv("SUPABASE_SERVICE_ROLE");
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

// optional helpers
export async function createSignedUrl(objectPath: string, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not create file URL");
  return data.signedUrl;
}

export function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

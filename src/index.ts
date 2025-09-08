import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

// Firebase Admin (modular)
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Supabase (server SDK)
import { createClient } from "@supabase/supabase-js";

function getServiceAccount() {
  if (process.env.SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
  }
  if (process.env.SERVICE_ACCOUNT_PATH) {
    const abs = path.resolve(process.cwd(), process.env.SERVICE_ACCOUNT_PATH);
    const text = fs.readFileSync(abs, "utf8");
    return JSON.parse(text);
  }
  throw new Error("Missing SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_PATH");
}

const sa = getServiceAccount();
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE!;
const bucket = process.env.SUPABASE_BUCKET || "worklogs";
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
}
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" })); // allow base64 pdfs

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Helper: convert data URL -> Buffer + contentType
function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL");
  const [, contentType, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), contentType };
}

app.post("/worklogs/upload-json", async (req, res) => {
  try {
    const { meta, pdfBase64 } = req.body || {};
    if (!meta || !pdfBase64) {
      return res.status(400).json({ error: "Missing meta or pdfBase64" });
    }

    // Optional size guard: Firestore doc does not store the PDF, only meta,
    // so no 1MB doc limit concern—but we still cap request size above.
    const id = `${meta.number || "no-num"}_${Date.now()}`;

    // 1) Upload PDF to Supabase Storage
    const { buffer, contentType } = dataUrlToBuffer(String(pdfBase64));
    const objectPath = `${id}.pdf`;
    const upload = await supabase.storage.from(bucket).upload(objectPath, buffer, {
      contentType: contentType || "application/pdf",
      upsert: false,
    });
    if (upload.error) {
      console.error("Supabase upload error:", upload.error);
      return res.status(500).json({ error: "Storage upload failed" });
    }

    // 2) ALWAYS use a signed URL (no getPublicUrl)
    const signed = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, 60 * 60 * 24 * 7); // 7 days

    if (signed.error || !signed.data?.signedUrl) {
      console.error("createSignedUrl error:", signed.error);
      return res.status(500).json({ error: "Could not create file URL" });
    }

    const fileUrl = signed.data.signedUrl;
    console.log("Signed (7d) URL:", fileUrl);
    
    

    // 2) Write metadata to Firestore (no PDF content)
    await db.collection("workLogs").doc(id).set({
      ...meta,
      fileUrl,          // URL to download/preview the PDF
      storage: "supabase",
      storageKey: `${bucket}/${objectPath}`,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, id, fileUrl });
  } catch (e: any) {
    console.error("upload-json error:", e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});

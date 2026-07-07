// src/lib/firebase.ts
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import dotenv from "dotenv";

// Initialize .env before anything else
dotenv.config();
/** Load Admin credential (env JSON, base64, or file path) */
function loadFirebaseCred() {
  console.log("process.env.SERVICE_ACCOUNT_PATH:", process.env.SERVICE_ACCOUNT_PATH);
  const raw =
    process.env.SERVICE_ACCOUNT_PATH ||
    "";
  if (!raw) throw new Error("FIREBASE_ADMIN_JSON missing");

  // Base64 JSON (CI-friendly)
  if (!raw.startsWith("{") && /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 200) {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  }
  // Inline JSON
  if (raw.trim().startsWith("{")) return JSON.parse(raw);
  // File path
  const p = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  const text = fs.readFileSync(p, "utf8");
  return JSON.parse(text);
}

/** SINGLE Admin app */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadFirebaseCred()),
    // No Firebase Storage here; PDFs are in Supabase.
  });
}

/** Exports you use elsewhere */
export const firebaseAdmin = admin;
export const db = admin.firestore();
export const auth = admin.auth();

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
export type Firestore = FirebaseFirestore.Firestore;
export type Transaction = FirebaseFirestore.Transaction;

export const serverTimestamp = () => FieldValue.serverTimestamp();

/** Helper: unified way to get the active survey id
 *  - Use route param when available (pass it through your handlers)
 *  - Otherwise, fallback to env for scripts/cron
 */
export function getSurveyId(fallback?: string) {
  return (
    fallback ||
    process.env.SURVEY_ID || // e.g., 'sv_main'
    "sv_main"
  );
}

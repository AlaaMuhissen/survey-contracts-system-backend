import fs from "fs";
import path from "path";
import { initializeApp, cert, getApps, getApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

/** Load service account from env or file (same behavior you had). */
export function getServiceAccount(): Record<string, any> {
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

/** Initialize once (safe for dev hot-reload). */
function getOrInitApp(): App {
  if (getApps().length) return getApp();
  const sa = getServiceAccount();
  return initializeApp({ credential: cert(sa) });
}

/** Firestore singleton */
export const app: App = getOrInitApp();
export const db: Firestore = getFirestore(app);

/** Re-exports so callers can use the same symbols as before. */
export { FieldValue, Timestamp };
export type { Transaction, Firestore };

/** Small helper for convenience (optional). */
export const serverTimestamp = () => FieldValue.serverTimestamp();

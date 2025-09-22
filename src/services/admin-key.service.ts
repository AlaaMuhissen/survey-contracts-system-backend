import { db, FieldValue, Timestamp } from "@lib/firebase.js";
import bcrypt from "bcryptjs";

/** Initialize admin key (stores hashed) */
export async function initAdminKey(key: string) {
  if (!key) throw new Error("Missing key");

  const hash = await bcrypt.hash(String(key), 12);
  await db.collection("config").doc("admin").set(
    {
      activeKeyHash: hash,
      previousKeyHash: null,
      graceUntil: null,
      rotatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
}

/** Read meta flags (for /admin/key/meta) */
export async function getAdminKeyMeta() {
  const doc = await db.collection("config").doc("admin").get();
  const cfg = doc.exists ? (doc.data() as any) : {};
  return {
    hasActive: !!cfg.activeKeyHash,
    hasPrevious: !!cfg.previousKeyHash,
    graceUntilMs: cfg.graceUntil?.toMillis?.() ?? null,
    rotatedAtMs: cfg.rotatedAt?.toMillis?.() ?? null,
  };
}

export type RotateArgs = {
  confirmKey: string;
  newKey?: string;
  graceHours?: number; // 0..72
};

/** Rotate key, returning the new plaintext ONCE (same behavior you have) */
export async function rotateAdminKey(args: RotateArgs) {
  const { confirmKey, newKey, graceHours } = args;

  const cfgRef = db.collection("config").doc("admin");
  const snap = await cfgRef.get();
  const current = snap.exists ? (snap.data() as any) : {};

  const okConfirm =
    current.activeKeyHash && (await bcrypt.compare(confirmKey, current.activeKeyHash));
  if (!okConfirm) {
    const err: any = new Error("Wrong current key");
    err.status = 401;
    throw err;
  }

  const plaintext =
    newKey && newKey.trim().length ? newKey.trim() : generateAdminKey();

  const nextHash = await bcrypt.hash(plaintext, 12);

  const hours = clamp(Number.isFinite(graceHours as any) ? (graceHours as number) : defaultGrace(), 0, 72);
  const graceUntil = Timestamp.fromMillis(Date.now() + hours * 3600 * 1000);

  await cfgRef.set(
    {
      previousKeyHash: current.activeKeyHash ?? null,
      activeKeyHash: nextHash,
      graceUntil,
      rotatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, key: plaintext, graceHours: hours, graceUntilMs: graceUntil.toMillis() };
}

/** Helpers */
function defaultGrace() {
  return Math.max(0, Number(process.env.ADMIN_KEY_GRACE_HOURS ?? 1));
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function generateAdminKey() {
  // 48 hex chars
  return require("node:crypto").randomBytes(24).toString("hex");
}

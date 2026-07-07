import { db } from "@lib/firebase";

// src/services/admin-key.service.ts
export function verifyAdminKey(key?: string): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  return key === expected;
}
// export async function getAdminKeyMeta() {
//   const doc = await db.collection("config").doc("admin").get();
//   const cfg = doc.exists ? (doc.data() as any) : {};
//   return {
//     hasActive: !!cfg.activeKeyHash,
//     hasPrevious: !!cfg.previousKeyHash,
//     graceUntilMs: cfg.graceUntil?.toMillis?.() ?? null,
//     rotatedAtMs: cfg.rotatedAt?.toMillis?.() ?? null,
//   };
// }

/** Robustly turn Firestore Timestamp/Date/epoch/object into Date */
export function coalesceDate(
  v: any
): Date {
  if (!v) return new Date();
  // Firestore Timestamp
  if (typeof v?.toDate === "function") return v.toDate();
  // { _seconds: number }
  if (typeof v?._seconds === "number") return new Date(v._seconds * 1000);
  // epoch ms
  if (typeof v === "number") return new Date(v);
  // ISO string
  if (typeof v === "string") return new Date(v);
  // Date object
  if (v instanceof Date) return v as Date;
  return new Date();
}

/** 2025-09-22 (UTC ISO slice) */
export function toDayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 2025-09 (UTC ISO slice) */
export function toMonthStr(d: Date): string {
  return d.toISOString().slice(0, 7);
}

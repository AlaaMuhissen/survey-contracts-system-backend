
/** Pad a number to fixed widthwith leading zeros. */
export function padSerial(n: number, width = 5): string {
  return String(n).padStart(width, "0");
}

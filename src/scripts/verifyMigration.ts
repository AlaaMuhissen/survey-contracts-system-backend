import "dotenv/config";
import { db } from "../lib/firebase";

const COMPANY_ID = process.env.MIGRATE_COMPANY_ID || "defaultCo";
const COLS = ["contracts", "submissions", "users", "stats"] as const;

async function count(path: string) {
  const snap = await db.collection(path).count().get().catch(async () => {
    // fallback for older count() support
    const s = await db.collection(path).get();
    return { data: () => ({ count: s.size }) } as any;
  });
  return (snap.data() as any).count as number;
}

(async () => {
  let ok = true;
  for (const col of COLS) {
    const oldPath = col;
    const newPath = `companies/${COMPANY_ID}/${col}`;
    const [oldN, newN] = await Promise.all([count(oldPath), count(newPath)]);
    const mark = oldN === newN ? "✅" : "⚠️";
    if (oldN !== newN) ok = false;
    console.log(`${mark} ${col.padEnd(12)} old: ${oldN.toString().padStart(4)}  →  new: ${newN.toString().padStart(4)}`);
  }
  console.log(ok ? "All good ✅" : "Some mismatches ⚠️ — inspect before deleting old collections.");
  process.exit(ok ? 0 : 1);
})();

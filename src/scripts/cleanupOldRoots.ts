// src/scripts/cleanupOldRoots.ts
import 'dotenv/config';
import { db } from '../lib/firebase';

const ROOTS = ['companies', 'projects', 'workLogs', 'config', 'counters'] as const;

async function deleteCollection(path: string, batchSize = 400) {
  let deleted = 0;
  // delete in pages to avoid timeouts
  // @ts-ignore
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    console.log(`Deleted ${snap.size} from ${path} (total ${deleted})`);
  }
  console.log(`Finished ${path}`);
}

(async () => {
  for (const root of ROOTS) {
    await deleteCollection(root);
  }
  console.log('Done deleting old roots.');
  process.exit(0);
})();

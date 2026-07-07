import 'dotenv/config';
import { db } from '../lib/firebase';

// set in .env or default:
const SURVEY_ID = process.env.SURVEY_ID || 'sv_main';

import { firebaseAdmin } from '../lib/firebase';

const opts = firebaseAdmin.app().options as any;
console.log('FIREBASE PROJECT (from Admin SDK):', opts.projectId || opts.credential?.projectId);
console.log('FIREBASE DB URL:', opts.databaseURL || '(none)');
console.log('FIRESTORE_EMULATOR_HOST:', process.env.FIRESTORE_EMULATOR_HOST || '(not set)');
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || '(not set)');

// root collections that should live under the survey:
const ROOTS = ['companies', 'projects', 'workLogs', 'config', 'counters'] as const;

async function moveCollection(rootName: string) {
  const fromPath = rootName;
  const toPath = `surveys/${SURVEY_ID}/${rootName}`;

  const snap = await db.collection(fromPath).get();
  console.log(`Moving ${snap.size} docs: ${fromPath} -> ${toPath}`);

  const batches: FirebaseFirestore.WriteBatch[] = [];
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    batch.set(db.doc(`${toPath}/${doc.id}`), doc.data(), { merge: true });
    ops++;
    if (ops >= 450) { batches.push(batch); batch = db.batch(); ops = 0; }
  }
  batches.push(batch);

  for (const b of batches) await b.commit();
}

(async () => {
  try {
    // ensure survey doc exists
    await db.doc(`surveys/${SURVEY_ID}`).set({
      createdAt: new Date(),
      name: 'Main Survey',
      nameLower: 'main survey'
    }, { merge: true });

    for (const root of ROOTS) {
      await moveCollection(root);
    }

    console.log('DONE ✅');
    process.exit(0);
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();

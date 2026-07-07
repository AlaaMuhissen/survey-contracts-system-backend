import 'dotenv/config';
import { db, firebaseAdmin } from '../lib/firebase';

const SURVEY_ID = process.env.SURVEY_ID || 'sv_main';

(async () => {
  const opts = firebaseAdmin.app().options as any;
  console.log('PROJECT:', opts.projectId);
  console.log('Checking root collections...');
  const rootCols = await (db as any).listCollections();
  console.log('Root collections:', rootCols.map((c: any) => c.id));

  // Check the survey doc itself
  const surveyDoc = await db.doc(`surveys/${SURVEY_ID}`).get();
  console.log(`survey doc surveys/${SURVEY_ID} exists?`, surveyDoc.exists);

  // List first few companies under the survey
  const companiesSnap = await db.collection(`surveys/${SURVEY_ID}/companies`).limit(5).get();
  console.log(`companies under surveys/${SURVEY_ID}:`, companiesSnap.size);
  companiesSnap.forEach(d => console.log('  -', d.id));

  // Put a visible marker to be sure
  await db.doc(`surveys/${SURVEY_ID}/__marker/__ping`).set({ at: new Date() });
  const ping = await db.doc(`surveys/${SURVEY_ID}/__marker/__ping`).get();
  console.log('marker exists?', ping.exists);

  // OPTIONAL: count old root collections so we see both sides
  const oldCompanies = await db.collection('companies').limit(5).get();
  console.log('root /companies docs (sample):', oldCompanies.size);
  oldCompanies.forEach(d => console.log('  *', d.id));
})();

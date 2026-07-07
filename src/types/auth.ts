// src/utils/auth.ts
import { auth, db, serverTimestamp } from "../lib/firebase";

/** Convert a UI username to an internal email for Firebase Auth. */
export const usernameToEmail = (u: string) =>
  `${u.trim().toLowerCase()}@yourapp.local`;

/** Create a SURVEY admin user (username/password) and set claims. */
export async function createSurveyAdminUser(
  surveyId: string,
  username: string,
  password: string
) {
  const email = usernameToEmail(username);
  const user = await auth.createUser({
    email,
    password,
    displayName: `Admin ${surveyId}`,
    emailVerified: true,
  });

  await auth.setCustomUserClaims(user.uid, {
    surveyId,
    role: "survey_admin",
  });

  await db.doc(`surveys/${surveyId}/users/${user.uid}`).set(
    {
      username,
      email,
      role: "survey_admin",
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { uid: user.uid, email };
}

/** Create a CONTRACTOR user (username/password) and set claims. */
export async function createContractorUser(
  surveyId: string,
  companyId: string,
  username: string,
  password: string,
  role: "contractor_admin" | "worker" | "viewer"
) {
  const email = usernameToEmail(username);
  const user = await auth.createUser({
    email,
    password,
    displayName: username,
    emailVerified: true,
  });

  await auth.setCustomUserClaims(user.uid, {
    surveyId,
    contractorId: companyId,
    role,
  });

  await db
    .doc(`surveys/${surveyId}/companies/${companyId}/users/${user.uid}`)
    .set(
      {
        username,
        email,
        role,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

  return { uid: user.uid, email };
}

// import jwt from "jsonwebtoken";

// const SECRET = process.env.APP_JWT_SECRET!;
// if (!SECRET) throw new Error("APP_JWT_SECRET missing");

// export type AppClaims = {
//   role: "worker" | "contractor_admin" | "survey_admin" | "superadmin";
//   surveyId: string;
//   contractorId?: string | null;
//   workerId?: string | null;
// };

// export function signAppJwt(claims: AppClaims, ttlSec = 60 * 60 * 24) {
//   return jwt.sign(claims, SECRET, { algorithm: "HS256", expiresIn: ttlSec });
// }

// export function verifyAppJwt(token: string): AppClaims {
//   return jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as AppClaims;
// }

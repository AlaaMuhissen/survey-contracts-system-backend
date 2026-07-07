import { Request, Response, NextFunction } from "express";
import { auth } from "../lib/firebase";



export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    // console.log("Authorization token:", token);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const decoded = await auth.verifyIdToken(token, true);
    const { uid, email } = decoded as any;
    const { surveyId, role } = (decoded as any);

    req.authUser = { uid, email, claims: { surveyId, role } };
    if (!surveyId && role !== "superadmin") {
      return res.status(403).json({ error: "Missing surveyId in token claims" });
    }

    next();
  } catch (e: any) {
    res.status(401).json({ error: "Invalid token", details: e.message });
  }
}

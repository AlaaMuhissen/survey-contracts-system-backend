import type { Request, Response, NextFunction } from "express";

/** Read key from "x-admin-key" or "Authorization: Bearer <key>" */
export function getProvidedKey(req: Request): string {
  return (
    req.get("x-admin-key") ||
    req.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

/**
 * Protect admin routes with a static env key.
 * If ADMIN_API_KEY is missing, allow all (same as your current behavior).
 */
export function adminKeyAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY || "";
  if (!expected) {
    console.warn("[adminKeyAuth] WARNING: no ADMIN_API_KEY in env — allowing all requests");
    return next();
  }
  const provided = getProvidedKey(req);
  if (provided !== expected) {
    return res.status(401).json({ error: "Bad admin key" });
  }
  return next();
}

/** Alias to keep old imports like `import { adminAuth } from "./adminAuth"` working */
export const adminAuth = adminKeyAuth;

export default adminKeyAuth;

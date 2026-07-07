import { Request, Response, NextFunction } from "express";


export function adminKeyAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY;
  console.log("Expected admin key:", expected);
  if (!expected) return res.status(500).json({ error: "ADMIN_API_KEY not set" });
  const key = req.headers["authorization"] || req.headers["Authorization"];
  console.log("Received admin key:", key);
  if (key === expected) return next();
  return res.status(401).json({ error: "Invalid or missing authorization header" });
}


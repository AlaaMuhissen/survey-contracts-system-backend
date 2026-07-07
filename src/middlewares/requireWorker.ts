import { db } from "@lib/firebase";
import { paths } from "@utils/paths";
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

interface WorkerJwt extends JwtPayload {
  workerId: string;
  surveyId: string;
  companyId: string;
  role: "worker";
}

export async function requireWorker(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_INVITE_SECRET!) as WorkerJwt;
    console.log("decoded:", decoded);

    if (decoded.role !== "worker")
      return res.status(403).json({ error: "Forbidden" });

   const workerSnap = await db.collection(paths.workers(decoded.surveyId))
    .where("workerId", "==", decoded.workerId)
    .limit(1)
    .get();

    if (workerSnap.empty) {
      return res.status(401).json({ error: "Worker not found (deleted)" });
    }
    const workerDoc = workerSnap.docs[0].data();
    if (workerDoc.disabled) {
      return res.status(403).json({ error: "Worker disabled" });
    }


    req.authUser = {
      uid: decoded.workerId,
      claims: {
        role: "worker",
        surveyId: decoded.surveyId,
  
      },
    };
    
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

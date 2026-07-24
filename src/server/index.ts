import express from "express";
import cors from "cors";
import morgan from "morgan";
import bodyParser from "body-parser";
import dotenv from "dotenv";

// Initialize .env before anything else
dotenv.config();

// Firebase admin initialization (will use your lib/firebase.ts)
import "../lib/firebase";

// Routes
import adminRoutes from "../routes/admin.routes";
import orgRoutes from "../routes/org.routes";
import reportsRoutes from "../routes/reports.routes";
import tenantsRoutes from "../routes/tenants.routes";
import worklogsRoutes from "../routes/worklogs.routes";
import publicRoutes from "../routes/public.routes";
import authRoutes from "../routes/auth.routes";
import workerAuthRoutes from "../routes/auth.worker.routes";
import adminSurveyRoutes from "../routes/survey.routes";
import signaturesRoutes from "../routes/signatures.routes";

// Express setup
const app = express();
const PORT = process.env.PORT || 8080;

// Global middlewares
app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json({ limit: "20mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Health endpoint
app.get("/", (req, res) => res.send("✅ Survey Contracts API is running"));
app.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Mount routes
app.use("/", publicRoutes);   // public endpoints (e.g. /api/public/surveys/:id/info)
app.use("/", tenantsRoutes);  // survey creation/invites
app.use("/", orgRoutes);      // companies, projects
app.use("/", adminRoutes);    // admin actions (PDF upload, user creation)
app.use("/", reportsRoutes);  // reports
app.use("/", worklogsRoutes); // work logs
app.use("/", authRoutes);
app.use("/", workerAuthRoutes);
app.use("/", adminSurveyRoutes);  // survey admin routes
app.use("/", signaturesRoutes);   // manager-signature requests
// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("🔥 Error:", err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
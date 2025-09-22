import "dotenv/config";
import express from "express";
import cors from "cors";
import { registerWorklogRoutes } from "../routes/worklogs.routes.js";
import { registerAdminRoutes } from "@routes/admin.routes.js";
import { registerPublicRoutes } from "@routes/public.routes.js";
import { registerReportRoutes } from "@routes/reports.routes.js";



const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

registerWorklogRoutes(app);
registerAdminRoutes(app);
registerPublicRoutes(app);
registerReportRoutes(app);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});

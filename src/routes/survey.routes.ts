import express from "express";
import { body } from "express-validator";
import multer from "multer"
import { db, FieldValue, serverTimestamp } from "../lib/firebase"; // your initialized Firestore + helper
import { requireAuth} from "@middlewares/requireAuth";
import { requireTenant } from "@middlewares/requireTenant";
import { uploadImageBuffer } from "@lib/cloudinary";

const r = express.Router();

/** GET /admin/surveys/:surveyId  -> read survey header fields */
r.get(
  "/admin/surveys/:surveyId",
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const ref = db.collection("surveys").doc(surveyId);
      const snap = await ref.get();

      if (!snap.exists) {
        return res.status(404).json({ error: "Survey not found" });
      }

      return res.json({ ok: true, survey: snap.data() });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

/** PATCH /admin/surveys/:surveyId  -> update text fields */
r.patch(
  "/admin/surveys/:surveyId",
  requireAuth, requireTenant,
  body("name").optional().isString().isLength({ max: 120 }),
  body("address").optional().isString().isLength({ max: 200 }),
  body("phone").optional().isString().isLength({ max: 40 }),
  body("businessId").optional().isString().isLength({ max: 40 }),
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const { name, address, phone, businessId } = req.body || {};
      const ref = db.collection("surveys").doc(surveyId);

      // create if missing (optional)
      const up = {
        ...(name       !== undefined ? { name }       : {}),
        ...(address    !== undefined ? { address }    : {}),
        ...(phone      !== undefined ? { phone }      : {}),
        ...(businessId !== undefined ? { businessId } : {}),
        updatedAt: serverTimestamp(),
      };

      await ref.set(up, { merge: true });
      const snap = await ref.get();
      res.json({ ok: true, survey: snap.data() });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

/** PUT /admin/surveys/:surveyId/logo  -> upload logo (multipart/form-data) */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

r.put(
  "/admin/surveys/:surveyId/logo",
  requireAuth, requireTenant,
  upload.single("logo"),
  async (req, res) => {
    try {
      const { surveyId } = req.params as any;
      const f = req.file;
      if (!f) return res.status(400).json({ error: "logo file required" });

      // where to store in Cloudinary — no extension in the public_id;
      // Cloudinary infers the format and appends the right extension itself.
      const objectPath = `surveys/${surveyId}/branding/logo`;

      // upload to Cloudinary (overwrite: true → matches Supabase's upsert behavior)
      const { secure_url: logoUrl } = await uploadImageBuffer(f.buffer, objectPath);

      // save on the survey doc
      await db.collection("surveys").doc(surveyId).set(
        { logoUrl, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      const snap = await db.collection("surveys").doc(surveyId).get();
      return res.json({ ok: true, survey: snap.data() });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

export default r;
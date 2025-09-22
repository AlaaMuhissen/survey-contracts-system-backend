import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
// Firebase Admin (modular)
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
// Supabase (server SDK)
import { createClient } from "@supabase/supabase-js";
// Read key from header ("x-admin-key" or "Authorization: Bearer <key>")
function getProvidedKey(req) {
    return (req.get("x-admin-key") ||
        req.get("authorization")?.replace(/^Bearer\s+/i, "") ||
        "");
}
export function adminKeyAuth(req, res, next) {
    const headerKey = req.header("x-admin-key") || "";
    const expected = process.env.ADMIN_API_KEY || "";
    if (!expected) {
        console.warn("[adminKeyAuth] WARNING: no ADMIN_KEY in env — allowing all requests");
        return next();
    }
    if (headerKey !== expected) {
        return res.status(401).json({ error: "Bad admin key" });
    }
    return next();
}
// Generate a random key (if admin doesn't choose one)
function generateAdminKey() {
    return crypto.randomBytes(24).toString("hex"); // 48 hex chars
}
// Default grace window (hours) – can override via .env
const GRACE_HOURS = Math.max(0, Number(process.env.ADMIN_KEY_GRACE_HOURS ?? 1) // default 1 hour
);
async function getNextSerial(opts = {}) {
    const { width = 5 } = opts;
    const ref = db.collection("counters").doc("workLogs");
    const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let n;
        if (!snap.exists) {
            n = 1;
            tx.set(ref, { seq: n, updatedAt: FieldValue.serverTimestamp() });
        }
        else {
            const current = Number(snap.data()?.seq ?? 0);
            n = current + 1;
            tx.update(ref, { seq: n, updatedAt: FieldValue.serverTimestamp() });
        }
        return n;
    });
    const serial = String(next).padStart(width, "0"); // ← "00003"
    console.log("[counter] next=", next, "serial=", serial);
    return { seq: next, serial };
}
// Load service account from env or file
function getServiceAccount() {
    if (process.env.SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
    }
    if (process.env.SERVICE_ACCOUNT_PATH) {
        const abs = path.resolve(process.cwd(), process.env.SERVICE_ACCOUNT_PATH);
        const text = fs.readFileSync(abs, "utf8");
        return JSON.parse(text);
    }
    throw new Error("Missing SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_PATH");
}
const sa = getServiceAccount();
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const bucket = process.env.SUPABASE_BUCKET || "Contracts";
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
}
const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" })); // allow base64 pdfs
app.get("/healthz", (_req, res) => res.json({ ok: true }));
// Helper: convert data URL -> Buffer + contentType
function dataUrlToBuffer(dataUrl) {
    const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (!m)
        throw new Error("Invalid data URL");
    const [, contentType, b64] = m;
    return { buffer: Buffer.from(b64, "base64"), contentType };
}
app.post("/worklogs/next-number", async (_req, res) => {
    try {
        const { serial, seq } = await getNextSerial({ width: 5 });
        res.json({ ok: true, number: serial, seq });
    }
    catch (e) {
        console.error("next-number error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.post("/worklogs/upload-json", async (req, res) => {
    try {
        const { meta = {}, pdfBase64 } = req.body || {};
        if (!pdfBase64)
            return res.status(400).json({ error: "Missing pdfBase64" });
        // NEW: accept provided number/seq from client (after reservation)
        const providedNumber = String(meta.number || "").trim();
        const providedSeq = Number.isFinite(meta.seq) ? Number(meta.seq) : undefined;
        let serial;
        let seq;
        if (providedNumber) {
            // NEW: reject if already used
            const docRef = db.collection("workLogs").doc(providedNumber);
            const existing = await docRef.get();
            if (existing.exists) {
                return res.status(409).json({
                    error: "Serial already used",
                    number: providedNumber,
                });
            }
            serial = providedNumber;
            seq = providedSeq; // keep client's reserved seq if sent
        }
        else {
            // Fallback: allocate on the server if client didn't reserve
            const nxt = await getNextSerial({ width: 5 });
            serial = nxt.serial;
            seq = nxt.seq;
        }
        const id = serial;
        // ---- upload to storage (unchanged except using `serial` in the path)
        const { buffer, contentType } = dataUrlToBuffer(String(pdfBase64));
        const objectPath = `${serial}.pdf`;
        const upload = await supabase.storage.from(bucket).upload(objectPath, buffer, {
            contentType: contentType || "application/pdf",
            upsert: true,
        });
        if (upload.error) {
            console.error("Supabase upload error:", upload.error);
            return res.status(500).json({ error: "Storage upload failed" });
        }
        const signed = await supabase.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
        if (signed.error || !signed.data?.signedUrl) {
            console.error("createSignedUrl error:", signed.error);
            return res.status(500).json({ error: "Could not create file URL" });
        }
        const fileUrl = signed.data.signedUrl;
        // ---- write Firestore doc
        const payload = {
            ...meta,
            number: serial,
            storage: "supabase-private",
            storageKey: `${bucket}/${objectPath}`,
            fileUrl,
            createdAt: FieldValue.serverTimestamp(),
        };
        if (typeof seq === "number")
            payload.seq = seq; // NEW: keep seq when known
        await db.collection("workLogs").doc(id).set(payload);
        return res.json({ ok: true, id, number: serial, seq: typeof seq === "number" ? seq : null, fileUrl });
    }
    catch (e) {
        console.error("upload-json error:", e);
        return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
    }
});
app.get("/admin/worklogs", adminKeyAuth, async (req, res) => {
    try {
        const { limit = "25", cursor, q } = req.query;
        let qry = db.collection("workLogs").orderBy("createdAt", "desc");
        if (q) {
            // simple example: prefix filter by number
            qry = qry.where("number", ">=", q).where("number", "<=", q + "\uf8ff");
        }
        if (cursor) {
            const afterMs = Number(cursor);
            qry = qry.startAfter(new Date(afterMs));
        }
        const snap = await qry.limit(Number(limit)).get();
        const items = snap.docs.map((d) => {
            const data = d.data();
            const ms = data.createdAt?.toMillis?.() ?? null;
            return {
                id: d.id,
                ...data,
                createdAtMs: ms, // ← number | null
                createdAtISO: ms ? new Date(ms).toISOString() : null,
            };
        });
        const last = items[items.length - 1];
        const nextCursor = last?.createdAtMs ? String(last.createdAtMs) : null;
        res.json({ items, nextCursor });
    }
    catch (e) {
        console.error("admin list error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.post("/admin/key/init", async (req, res) => {
    try {
        const { key } = req.body || {};
        if (!key)
            return res.status(400).json({ error: "Missing key" });
        const hash = await bcrypt.hash(String(key), 12);
        await db.collection("config").doc("admin").set({
            activeKeyHash: hash,
            previousKeyHash: null,
            graceUntil: null,
            rotatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (e) {
        console.error("init key error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.get("/admin/key/meta", adminKeyAuth, async (_req, res) => {
    const doc = await db.collection("config").doc("admin").get();
    const cfg = doc.exists ? doc.data() : {};
    res.json({
        hasActive: !!cfg.activeKeyHash,
        hasPrevious: !!cfg.previousKeyHash,
        graceUntilMs: cfg.graceUntil?.toMillis?.() ?? null,
        rotatedAtMs: cfg.rotatedAt?.toMillis?.() ?? null,
    });
});
const RotateSchema = z.object({
    confirmKey: z.string().min(1),
    newKey: z
        .string()
        .optional()
        .refine((v) => !v || v.length >= 16 || v.trim().split(/\s+/).length >= 4, "Key too weak: use ≥16 chars or a 4+ word passphrase"),
    graceHours: z.number().int().min(0).max(72).optional(),
});
app.post("/admin/key/rotate", adminKeyAuth, async (req, res) => {
    try {
        const { confirmKey, newKey, graceHours } = RotateSchema.parse(req.body || {});
        const cfgRef = db.collection("config").doc("admin");
        const snap = await cfgRef.get();
        const current = snap.exists ? snap.data() : {};
        // Confirm current key matches active
        const okConfirm = current.activeKeyHash &&
            (await bcrypt.compare(confirmKey, current.activeKeyHash));
        if (!okConfirm)
            return res.status(401).json({ error: "Wrong current key" });
        const plaintext = newKey && newKey.trim().length ? newKey.trim() : generateAdminKey();
        const nextHash = await bcrypt.hash(plaintext, 12);
        const hours = Number.isFinite(graceHours) ? graceHours : GRACE_HOURS;
        const graceUntil = Timestamp.fromMillis(Date.now() + hours * 3600 * 1000);
        await cfgRef.set({
            previousKeyHash: current.activeKeyHash ?? null,
            activeKeyHash: nextHash,
            graceUntil,
            rotatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        // Return NEW key (plaintext) ONCE so the admin can copy it
        res.json({
            ok: true,
            key: plaintext,
            graceHours: hours,
            graceUntilMs: graceUntil.toMillis(),
        });
    }
    catch (e) {
        if (e?.issues)
            return res.status(400).json({ error: e.issues[0]?.message || "Bad input" });
        console.error("rotate key error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.post("/admin/projects", adminKeyAuth, async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();
        const companyId = String(req.body?.companyId || "").trim();
        if (!name || !companyId)
            return res.status(400).json({ error: "Missing name/companyId" });
        const company = await db.collection("companies").doc(companyId).get();
        if (!company.exists)
            return res.status(404).json({ error: "Company not found" });
        const companyName = company.data().name;
        const doc = await db.collection("projects").add({
            name,
            nameLower: name.toLowerCase(),
            companyId,
            companyName,
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
        });
        res.json({ ok: true, id: doc.id, name, companyId, companyName });
    }
    catch (e) {
        console.error("add project error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.get("/admin/projects", adminKeyAuth, async (req, res) => {
    try {
        const companyId = req.query.companyId || undefined;
        const col = db.collection("projects");
        const snap = companyId
            ? await col.where("companyId", "==", companyId).get()
            : await col.get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ items });
    }
    catch (e) {
        console.error("list projects error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.patch("/admin/projects/:id", adminKeyAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const patch = {};
        if (typeof req.body?.isActive === "boolean")
            patch.isActive = req.body.isActive;
        if (req.body?.name) {
            patch.name = String(req.body.name).trim();
            patch.nameLower = patch.name.toLowerCase();
        }
        if (!Object.keys(patch).length)
            return res.status(400).json({ error: "Nothing to update" });
        await db.collection("projects").doc(id).set(patch, { merge: true });
        res.json({ ok: true });
    }
    catch (e) {
        console.error("patch project error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.delete("/admin/projects/:id", adminKeyAuth, async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection("projects").doc(id).delete();
        res.json({ ok: true });
    }
    catch (e) {
        console.error("delete project error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.post("/admin/companies", adminKeyAuth, async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();
        if (!name)
            return res.status(400).json({ error: "Missing company name" });
        const doc = await db.collection("companies").add({
            name,
            nameLower: name.toLowerCase(),
            createdAt: FieldValue.serverTimestamp(),
        });
        res.json({ ok: true, id: doc.id, name });
    }
    catch (e) {
        console.error("add company error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.get("/admin/companies", adminKeyAuth, async (req, res) => {
    try {
        const limit = Math.min(100, Number(req.query.limit || 50));
        const qText = String(req.query.q || "").trim().toLowerCase();
        let q = db.collection("companies").orderBy("createdAt", "desc").limit(limit);
        const snap = await q.get();
        let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (qText)
            items = items.filter(c => c.nameLower?.includes(qText));
        res.json({ items });
    }
    catch (e) {
        console.error("list companies error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.delete("/admin/companies/:id", adminKeyAuth, async (req, res) => {
    const id = req.params.id;
    try {
        // 1) collect related projects
        const projSnap = await db.collection("projects").where("companyId", "==", id).get();
        // 2) delete in chunks (max 500 per batch; keep margin)
        let batch = db.batch();
        let ops = 0;
        for (const doc of projSnap.docs) {
            batch.delete(doc.ref);
            ops++;
            if (ops >= 450) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0)
            await batch.commit();
        // 3) delete the company itself
        await db.collection("companies").doc(id).delete();
        res.json({ ok: true, deletedProjects: projSnap.size, companyId: id });
    }
    catch (e) {
        console.error("delete company (with projects) error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
// GET /public/companies  ->  [{id, name, active?}]
app.get("/public/companies", async (_req, res) => {
    try {
        const snap = await db.collection("companies").orderBy("name").get();
        const items = snap.docs.map(d => {
            const data = d.data();
            return { id: d.id, name: data.name || "", active: data.active ?? true };
        });
        res.json({ items, updatedAt: Date.now() });
    }
    catch (e) {
        console.error("list companies error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
// GET /public/projects?companyId=abc123 -> [{id,name,companyId,active?}]
app.get("/public/projects", async (req, res) => {
    try {
        const companyId = String(req.query.companyId || "");
        if (!companyId)
            return res.status(400).json({ error: "Missing companyId" });
        // Only filter by companyId (no server orderBy to avoid index requirements)
        const snap = await db.collection("projects")
            .where("companyId", "==", companyId)
            .get();
        let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // filter inactive
        items = items.filter(p => p.active !== false);
        // sort by Hebrew/English name on the server (in code), not Firestore
        items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "he"));
        res.json({ items, updatedAt: Date.now() });
    }
    catch (e) {
        console.error("list projects error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
// GET /admin/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&company=&project=
app.get("/admin/reports/summary", adminKeyAuth, async (req, res) => {
    const { from, to, company, project } = req.query;
    let q = db.collection("worklogs");
    if (from)
        q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)
        q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));
    if (company)
        q = q.where("company", "==", company);
    if (project)
        q = q.where("project", "==", project);
    const snap = await q.get();
    const byDay = {};
    const byMonth = {};
    let full = 0, half = 0;
    snap.forEach(d => {
        const w = d.data();
        const dt = w.createdAt?.toDate ? w.createdAt.toDate() : new Date();
        const day = dt.toISOString().slice(0, 10);
        const month = dt.toISOString().slice(0, 7);
        const kind = w.dayType === "half" ? "half" : "full";
        byDay[day] ?? (byDay[day] = { all: 0, full: 0, half: 0 });
        byMonth[month] ?? (byMonth[month] = { all: 0, full: 0, half: 0 });
        byDay[day].all++;
        byMonth[month].all++;
        byDay[day][kind]++;
        byMonth[month][kind]++;
        kind === "half" ? half++ : full++;
    });
    res.json({
        totals: { all: full + half, full, half },
        byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        byMonth: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    });
});
// GET /admin/reports/company-project-days?from=YYYY-MM-DD&to=YYYY-MM-DD&company=&project=&format=csv
// Accepts: from=YYYY-MM-DD, to=YYYY-MM-DD
// company: either company NAME or companies/{id}
// project: either project NAME or projects/{id} (resolved within chosen company if needed)
app.get("/admin/reports/company-project-days", adminKeyAuth, async (req, res) => {
    try {
        let { from, to, company, project, format, all } = req.query;
        // Normalize filters
        const includeAll = all === "1" || all === "true";
        const coQ = (typeof company === "string" ? company : "").trim().toLowerCase();
        const prQ = (typeof project === "string" ? project : "").trim().toLowerCase();
        const startDate = (typeof from === "string" && from) ? new Date(`${from}T00:00:00Z`) : null;
        const endDate = (typeof to === "string" && to) ? new Date(`${to}T23:59:59Z`) : null;
        console.log("[report] params:", { from, to, company, project, includeAll });
        console.log("[report] range:", { startDate, endDate });
        // Helper
        const dayOf = (w) => {
            const dt = w.createdAt?.toDate ? w.createdAt.toDate() :
                (w.createdAt?._seconds ? new Date(w.createdAt._seconds * 1000) :
                    (w.createdAt ? new Date(w.createdAt) : new Date()));
            return { dt, dayStr: dt.toISOString().slice(0, 10) };
        };
        // 1) Fetch by date only (no composite index required)
        let baseQuery = db.collection("workLogs"); // <-- exact collection name
        // if (!includeAll) {
        //   if (startDate) baseQuery = baseQuery.where("createdAt", ">=", startDate);
        //   if (endDate)   baseQuery = baseQuery.where("createdAt", "<=", endDate);
        // }
        const snap = await baseQuery.get();
        console.log("[report] base fetch docs:", snap.size);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtered = docs.filter((w) => {
            const { dt } = dayOf(w);
            if (!includeAll) {
                if (startDate && dt < startDate)
                    return false;
                if (endDate && dt > endDate)
                    return false;
            }
            const co = ((w.company ?? "") + "").trim().toLowerCase();
            const pr = ((w.project ?? "") + "").trim().toLowerCase();
            if (coQ && co !== coQ)
                return false;
            if (prQ && pr !== prQ)
                return false;
            return true;
        });
        console.log("[report] filtered docs:", filtered.length);
        const agg = new Map();
        for (const w of filtered) {
            const companyName = ((w.company ?? "—") + "").trim();
            const projectName = ((w.project ?? "—") + "").trim();
            const kind = (w.dayType === "half") ? "half" : "full";
            const { dayStr } = dayOf(w);
            if (!agg.has(companyName))
                agg.set(companyName, new Map());
            const byProj = agg.get(companyName);
            if (!byProj.has(projectName))
                byProj.set(projectName, { days: new Set(), full: 0, half: 0 });
            const rec = byProj.get(projectName);
            rec.days.add(dayStr);
            if (kind === "half")
                rec.half++;
            else
                rec.full++;
        }
        // 4) Flatten to rows
        const rows = [];
        for (const [co, byProj] of agg.entries()) {
            for (const [pr, rec] of byProj.entries()) {
                rows.push({
                    company: co,
                    project: pr,
                    uniqueDays: rec.days.size,
                    fullCount: rec.full,
                    halfCount: rec.half,
                    logsTotal: rec.full + rec.half * 0.5,
                });
            }
        }
        rows.sort((a, b) => a.company.localeCompare(b.company, "he") || a.project.localeCompare(b.project, "he"));
        if (format === "csv") {
            const header = "company,project,uniqueDays,fullCount,halfCount,logsTotal\n";
            const body = rows.map(r => [
                JSON.stringify(r.company),
                JSON.stringify(r.project),
                r.uniqueDays, r.fullCount, r.halfCount, r.logsTotal
            ].join(",")).join("\n");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.send(header + body);
        }
        else {
            res.json({ from: from || null, to: to || null, count: rows.length, rows });
        }
    }
    catch (e) {
        console.error("[report] error:", e);
        res.status(500).json({ error: "Internal error" });
    }
});
app.get("/admin/reports/by-company", adminKeyAuth, async (req, res) => {
    const { from, to } = req.query;
    let q = db.collection("workLogs");
    if (from)
        q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)
        q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));
    const snap = await q.get();
    const map = new Map();
    let total = 0;
    snap.forEach(d => {
        const w = d.data();
        const key = (w.company || "—").trim();
        const r = map.get(key) || { all: 0, full: 0, half: 0 };
        r.all++;
        total++;
        if (w.dayType === "half")
            r.half++;
        else
            r.full++;
        map.set(key, r);
    });
    const rows = [...map.entries()]
        .map(([company, v]) => ({ company, ...v, pct: total ? +(v.all * 100 / total).toFixed(1) : 0 }))
        .sort((a, b) => b.all - a.all);
    res.json({ rows, total });
});
app.get("/admin/reports/worker-utilization", adminKeyAuth, async (req, res) => {
    const { from, to, company, project, workerId, format } = req.query;
    let q = db.collection("worklogs");
    if (from)
        q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)
        q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));
    if (company)
        q = q.where("company", "==", company); // company name
    if (project)
        q = q.where("project", "==", project); // project name
    if (workerId)
        q = q.where("workerId", "==", workerId);
    q = q.orderBy("createdAt", "asc");
    const snap = await q.get();
    const m = new Map();
    snap.forEach(d => {
        const w = d.data();
        const dt = w.createdAt?.toDate ? w.createdAt.toDate() : new Date();
        const day = dt.toISOString().slice(0, 10);
        const kind = w.dayType === "half" ? "half" : "full";
        // If filters were provided, we echo them in the row; otherwise leave blank.
        const key = `${w.workerId}|${company ? w.company : ""}|${project ? w.project : ""}`;
        const row = m.get(key) ?? {
            workerId: w.workerId || "",
            worker: w.workerName || w.worker || "",
            company: company ? (w.company || company) : "",
            project: project ? (w.project || project) : "",
            fullCount: 0,
            halfCount: 0,
            logsTotal: 0,
            dates: new Set(),
        };
        kind === "half" ? row.halfCount++ : row.fullCount++;
        row.logsTotal++;
        row.dates.add(day);
        m.set(key, row);
    });
    const rows = Array.from(m.values()).map(r => ({
        workerId: r.workerId,
        worker: r.worker,
        company: r.company || "",
        project: r.project || "",
        FTE_days: r.fullCount + 0.5 * r.halfCount,
        uniqueDays: r.dates.size,
        fullCount: r.fullCount,
        halfCount: r.halfCount,
        logsTotal: r.logsTotal,
    })).sort((a, b) => b.FTE_days - a.FTE_days);
    if (format === "csv") {
        const wrap = (s) => {
            const v = String(s ?? "");
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        };
        const header = "workerId,worker,company,project,FTE_days,uniqueDays,fullCount,halfCount,logsTotal";
        const csv = [header, ...rows.map(r => [r.workerId, wrap(r.worker), wrap(r.company), wrap(r.project),
                r.FTE_days, r.uniqueDays, r.fullCount, r.halfCount, r.logsTotal].join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        return res.send(csv);
    }
    res.json({ rows });
});
app.get("/admin/reports/company-summary", adminKeyAuth, async (req, res) => {
    const { from, to, format } = req.query;
    let q = db.collection("worklogs");
    if (from)
        q = q.where("createdAt", ">=", new Date(from + "T00:00:00Z"));
    if (to)
        q = q.where("createdAt", "<=", new Date(to + "T23:59:59Z"));
    q = q.orderBy("createdAt", "asc");
    const snap = await q.get();
    const m = new Map();
    snap.forEach(d => {
        const w = d.data();
        const dt = w.createdAt?.toDate ? w.createdAt.toDate() : new Date();
        const day = dt.toISOString().slice(0, 10);
        const company = w.company || "—";
        const kind = w.dayType === "half" ? "half" : "full";
        const row = m.get(company) ?? {
            company,
            fullCount: 0,
            halfCount: 0,
            logsTotal: 0,
            dates: new Set(),
            workers: new Set(),
            projects: new Set(),
        };
        kind === "half" ? row.halfCount++ : row.fullCount++;
        row.logsTotal++;
        row.dates.add(day);
        if (w.workerId)
            row.workers.add(w.workerId);
        if (w.projectId || w.project)
            row.projects.add(w.projectId || w.project);
        m.set(company, row);
    });
    const rows = Array.from(m.values()).map(r => ({
        company: r.company,
        FTE_days: r.fullCount + 0.5 * r.halfCount,
        uniqueDays: r.dates.size,
        workersCount: r.workers.size,
        projectsCount: r.projects.size,
        logsTotal: r.logsTotal,
        fullCount: r.fullCount,
        halfCount: r.halfCount,
    })).sort((a, b) => b.FTE_days - a.FTE_days);
    if (format === "csv") {
        const wrap = (s) => {
            const v = String(s ?? "");
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        };
        const header = "company,FTE_days,uniqueDays,workersCount,projectsCount,logsTotal,fullCount,halfCount";
        const csv = [header, ...rows.map(r => [wrap(r.company), r.FTE_days, r.uniqueDays, r.workersCount, r.projectsCount,
                r.logsTotal, r.fullCount, r.halfCount].join(","))].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        return res.send(csv);
    }
    res.json({ rows });
});
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log("Server listening on", PORT);
});

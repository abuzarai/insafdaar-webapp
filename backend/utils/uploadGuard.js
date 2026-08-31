// backend/utils/uploadGuard.js
// Authenticated serving for /uploads/* (audit #17-2).
//
// Only avatar files (/uploads/avatars/*) stay public — they back the public
// "Meet Our Advocates" listing. Everything else requires a valid JWT and an
// ownership/role check resolved per file bucket:
//   documents/            -> client_documents owner (or advocate assigned to the client, or admin)
//   case-documents/       -> case parties (client owner / assigned advocate) + admin
//   case-audio/           -> case parties + admin
//   vouchers/ and root    -> client_billing owner / case parties + admin
//   contracts/            -> case_contract_attachments case parties + admin
//   advocate/documents/   -> the advocate themself + admin
import fs from "fs";
import path from "path";
import pool from "../db.js";

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".txt": "text/plain",
};

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/** Resolve a request path under /uploads to an absolute path inside the uploads root. */
export function resolveUploadPath(relPath) {
  const root = path.resolve("uploads");
  const candidate = path.resolve(root, String(relPath || "").replace(/^\/+/, ""));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

export function streamFile(res, absPath) {
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return res.status(404).json({ error: "Not found" });
  }
  res.setHeader("Content-Type", contentTypeFor(absPath));
  res.setHeader("Content-Disposition", "inline");
  const stream = fs.createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
    else res.end();
  });
  stream.pipe(res);
}

async function caseAccess(caseId, user) {
  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN") return true;
  if (role === "CLIENT") {
    const r = await pool.query(
      `SELECT 1 FROM public.client_cases WHERE id=$1 AND user_id=$2 LIMIT 1`,
      [Number(caseId), Number(user.id)]
    );
    return r.rows.length > 0;
  }
  if (role === "ADVOCATE") {
    const r = await pool.query(
      `SELECT 1 FROM public.client_cases WHERE id=$1 AND assigned_advocate_id=$2 LIMIT 1`,
      [Number(caseId), Number(user.id)]
    );
    return r.rows.length > 0;
  }
  return false;
}

/** Decide whether req.user may read the file at req.path (relative to /uploads). */
export async function resolveFileAccess(req) {
  const user = req.user;
  if (!user) return false;

  const rel = req.path || "";
  const segs = rel.split("/").filter(Boolean);
  const file = decodeURIComponent(segs[segs.length - 1] || "");
  const bucket = segs.slice(0, -1).join("/");

  if (bucket === "avatars") return true;

  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN") return true;
  const userId = Number(user.id);

  let caseId = null;

  if (bucket === "documents") {
    const r = await pool.query(
      `SELECT user_id FROM public.client_documents WHERE file_url=$1 LIMIT 1`,
      [`/uploads/documents/${file}`]
    );
    const ownerId = r.rows[0]?.user_id;
    if (!ownerId) return false;
    if (role === "CLIENT") return Number(ownerId) === userId;
    // advocate: only if assigned to a case of this client's
    const s = await pool.query(
      `SELECT 1 FROM public.client_cases c WHERE c.user_id=$1 AND c.assigned_advocate_id=$2 LIMIT 1`,
      [Number(ownerId), userId]
    );
    return s.rows.length > 0;
  }

  if (bucket === "case-documents") {
    const r = await pool.query(
      `SELECT case_id FROM public.case_documents WHERE file_url=$1 LIMIT 1`,
      [`/uploads/case-documents/${file}`]
    );
    caseId = r.rows[0]?.case_id ?? null;
  } else if (bucket === "case-audio") {
    const r = await pool.query(
      `SELECT case_id FROM public.case_intake_sessions WHERE audio_url=$1 LIMIT 1`,
      [`/uploads/case-audio/${file}`]
    );
    caseId = r.rows[0]?.case_id ?? null;
  } else if (bucket === "vouchers" || bucket === "") {
    const url = bucket === "" ? `/uploads/${file}` : `/uploads/vouchers/${file}`;
    const r = await pool.query(
      `SELECT user_id, case_id FROM public.client_billing
       WHERE voucher_file_url=$1 OR voucher_pdf_url=$1 LIMIT 1`,
      [url]
    );
    const row = r.rows[0];
    if (!row) return false;
    if (role === "CLIENT") return Number(row.user_id) === userId;
    caseId = Number(row.case_id) || null;
  } else if (bucket === "contracts") {
    const r = await pool.query(
      `SELECT case_id FROM public.case_contract_attachments WHERE file_path=$1 LIMIT 1`,
      [file]
    );
    caseId = r.rows[0]?.case_id ?? null;
  } else if (bucket === "advocate/documents") {
    const r = await pool.query(
      `SELECT user_id FROM public.advocate_verification_documents WHERE file_path=$1 AND user_id=$2 LIMIT 1`,
      [file, userId]
    );
    return r.rows.length > 0;
  } else {
    return false; // unknown bucket: deny
  }

  if (!caseId) return false;
  return caseAccess(caseId, user);
}

/** Express middleware for /uploads. Avatars stay public; everything else needs JWT + access. */
export function uploadGuard(verifyToken) {
  return async (req, res) => {
    try {
      const relPath = req.path;
      if (String(relPath).startsWith("/avatars/")) {
        const abs = resolveUploadPath(relPath);
        return abs ? streamFile(res, abs) : res.status(400).json({ error: "Bad path" });
      }

      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const decoded = verifyToken ? verifyToken(token) : null;
      if (!decoded) return res.status(401).json({ error: "Unauthorized" });

      req.user = decoded;
      if (!(await resolveFileAccess(req))) return res.status(403).json({ error: "Forbidden" });

      const abs = resolveUploadPath(relPath);
      if (!abs) return res.status(400).json({ error: "Bad path" });
      return streamFile(res, abs);
    } catch (e) {
      console.error("upload guard error:", e);
      return res.status(500).json({ error: "Server error" });
    }
  };
}
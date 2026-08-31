// One-off maintenance script: rename every file under uploads/ to an
// unguessable token name and rewrite DB rows that referenced the old public
// URLs (audit #17 — predictable `/uploads/...` filenames with user/case ids).
//
// Run inside the backend container (env vars + uploads mount present):
//   docker cp backend/scripts/rotateUploadFilenames.js insafdaar-backend:/app/scripts/
//   docker exec insafdaar-backend node scripts/rotateUploadFilenames.js
//
// Idempotent: files already matching the token pattern (24 hex + ext) are
// skipped; re-running is safe. Writes a rollback manifest to
// /app/uploads-rotate-manifest.json (outside the served uploads tree).
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import pg from "pg";

const UPLOADS_ROOT = path.resolve("uploads");
const MANIFEST_PATH = path.resolve("uploads-rotate-manifest.json");
const TOKEN_RE = /^[0-9a-f]{24}\.[a-z0-9]+$/; // randomFileName() output

// Every table/column that can hold a public upload URL.
const TARGETS = [
  ["client_documents", "file_url"],
  ["client_payment_proofs", "proof_file_url"],
  ["client_billing", "voucher_pdf_url"],
  ["client_billing", "voucher_file_url"],
  ["document_extraction_jobs", "file_url"],
  ["client_profiles", "avatar_url"],
  ["advocate_profiles", "avatar_url"],
  ["case_voice_notes", "audio_url"],
  ["case_intake_sessions", "audio_url"],
  ["case_documents", "file_url"],
  ["case_contract_attachments", "file_path"],
  ["advocate_verification_documents", "file_path"],
  ["case_hearing_drafts", "file_url"],
  ["case_hearing_evidence", "file_url"],
];

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || "insafdaar_db",
});

async function collectReferencedUrls() {
  const urls = new Set();
  for (const [table, column] of TARGETS) {
    const r = await pool.query(
      `SELECT DISTINCT ${column} FROM ${table} WHERE ${column} LIKE '/uploads/%'`
    );
    for (const row of r.rows) {
      const v = row[column];
      if (typeof v === "string") urls.add(v);
    }
  }
  return [...urls];
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

async function main() {
  const manifest = { runAt: new Date().toISOString(), mappings: [] };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      if (prev.mappings?.length) {
        console.log(`Prior manifest found (${prev.mappings.length} renames); resuming from it.`);
        manifest.mappings = prev.mappings;
      }
    } catch {}
  }
  const alreadyDone = new Map(manifest.mappings.map((m) => [m.old, m.new]));

  // 1. Rename every file on disk to a token name.
  const files = walkFiles(UPLOADS_ROOT);
  let renamed = 0;
  const diskMap = new Map(); // oldAbsPath -> newAbsPath
  for (const abs of files) {
    const rel = path.relative(UPLOADS_ROOT, abs);
    const name = path.basename(abs);
    const ext = path.extname(name).toLowerCase() || "";
    if (TOKEN_RE.test(name)) {
      diskMap.set(abs, abs); // already tokenized
      continue;
    }
    const newName = `${randomBytes(12).toString("hex")}${ext}`;
    const newAbs = path.join(path.dirname(abs), newName);
    fs.renameSync(abs, newAbs);
    diskMap.set(abs, newAbs);
    renamed++;
  }
  console.log(`Renamed ${renamed} file(s) under ${UPLOADS_ROOT}`);

  // 2. Rewrite DB references (old public URL -> new public URL).
  const referenced = await collectReferencedUrls();
  let updated = 0;
  for (const oldUrl of referenced) {
    // /uploads/<subdir>/<oldname>
    const relToRoot = oldUrl.replace(/^\/uploads\//, "");
    const oldAbs = path.join(UPLOADS_ROOT, relToRoot);
    const newAbs = diskMap.get(oldAbs) || alreadyDone.get(oldUrl);
    if (!newAbs || newAbs === oldAbs || fs.existsSync(oldAbs)) {
      if (fs.existsSync(oldAbs)) {
        console.warn(`  SKIP (file unchanged): ${oldUrl}`);
      } else if (!newAbs) {
        console.warn(`  SKIP (no mapping): ${oldUrl}`);
      } else {
        console.warn(`  SKIP (already mapped): ${oldUrl} -> ${newAbs}`);
      }
      // Record mapping anyway for manifest completeness.
      const newUrl = newAbs ? `/uploads/${path.relative(UPLOADS_ROOT, newAbs).split(path.sep).join("/")}` : null;
      if (newUrl && !manifest.mappings.find((m) => m.old === oldUrl)) {
        manifest.mappings.push({ old: oldUrl, new: newUrl, alreadyMapped: true });
      }
      continue;
    }
    const newUrl = `/uploads/${path.relative(UPLOADS_ROOT, newAbs).split(path.sep).join("/")}`;
    for (const [table, column] of TARGETS) {
      const r = await pool.query(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
        [newUrl, oldUrl]
      );
      updated += r.rowCount || 0;
    }
    manifest.mappings.push({ old: oldUrl, new: newUrl });
    console.log(`  ${oldUrl} -> ${newUrl}`);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Updated ${updated} DB cell(s); manifest at ${MANIFEST_PATH}`);

  // 3. Verify: no referenced URL still points at a stale name.
  const remaining = await collectReferencedUrls();
  const stale = remaining.filter((u) => !TOKEN_RE.test(path.basename(u)));
  if (stale.length) {
    console.error("STALE REFERENCES REMAIN:", stale);
    process.exitCode = 1;
  } else {
    console.log(`Verify OK: all ${remaining.length} referenced upload URLs are tokenized.`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("Migration failed:", e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
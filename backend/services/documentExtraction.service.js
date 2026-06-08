import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";

import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_ROOT = path.resolve(__dirname, "..", "uploads");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);

function normalizePathFromFileUrl(fileUrl) {
  const clean = String(fileUrl || "").split("?")[0];
  if (!clean.startsWith("/uploads/")) {
    throw new Error(`Unsupported file URL: ${clean}`);
  }

  const relative = clean.replace(/^\/uploads\//, "");
  const resolved = path.resolve(UPLOADS_ROOT, relative);
  if (!resolved.startsWith(UPLOADS_ROOT)) {
    throw new Error("Blocked path traversal in file URL");
  }
  return resolved;
}

function extFromFileUrl(fileUrl) {
  const clean = String(fileUrl || "").split("?")[0];
  return path.extname(clean).toLowerCase();
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  return normalizeWhitespace(parsed?.text || "");
}

async function extractImageText(filePath) {
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(filePath);
    return normalizeWhitespace(result?.data?.text || "");
  } finally {
    await worker.terminate();
  }
}

async function extractTextForDocument(fileUrl) {
  const filePath = normalizePathFromFileUrl(fileUrl);
  const ext = extFromFileUrl(fileUrl);

  if (ext === ".pdf") {
    return await extractPdfText(filePath);
  }
  if (IMAGE_EXTS.has(ext)) {
    return await extractImageText(filePath);
  }

  throw new Error(`Unsupported file extension for extraction: ${ext || "(none)"}`);
}

function targetTableOrThrow(sourceTable) {
  if (sourceTable === "case_documents" || sourceTable === "client_documents") {
    return sourceTable;
  }
  throw new Error(`Invalid source table: ${sourceTable}`);
}

export async function enqueueDocumentExtractionJobs(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let queued = 0;

    for (const row of rows) {
      const sourceTable = targetTableOrThrow(row.source_table);
      const documentId = Number(row.document_id);
      const fileUrl = String(row.file_url || "");
      const caseId = row.case_id == null ? null : Number(row.case_id);
      const userId = row.user_id == null ? null : Number(row.user_id);

      if (!documentId || !fileUrl) continue;

      await client.query(
        `
        INSERT INTO public.document_extraction_jobs
          (source_table, document_id, file_url, case_id, user_id, status, attempts, next_run_at, last_error, locked_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, 'PENDING', 0, NOW(), NULL, NULL, NOW())
        ON CONFLICT (source_table, document_id)
        DO UPDATE SET
          file_url = EXCLUDED.file_url,
          case_id = EXCLUDED.case_id,
          user_id = EXCLUDED.user_id,
          status = CASE
            WHEN public.document_extraction_jobs.status = 'DONE' AND COALESCE(public.document_extraction_jobs.file_url, '') = EXCLUDED.file_url
              THEN public.document_extraction_jobs.status
            ELSE 'PENDING'
          END,
          attempts = CASE
            WHEN public.document_extraction_jobs.status = 'DONE' AND COALESCE(public.document_extraction_jobs.file_url, '') = EXCLUDED.file_url
              THEN public.document_extraction_jobs.attempts
            ELSE 0
          END,
          next_run_at = NOW(),
          last_error = NULL,
          locked_at = NULL,
          updated_at = NOW()
        `,
        [sourceTable, documentId, fileUrl, caseId, userId]
      );

      await client.query(
        `
        UPDATE public.${sourceTable}
        SET
          extraction_status = 'PENDING',
          extraction_error = NULL,
          extraction_updated_at = NOW(),
          extraction_attempts = 0,
          extracted_text = NULL,
          extracted_text_at = NULL
        WHERE id = $1
        `,
        [documentId]
      );

      queued += 1;
    }

    await client.query("COMMIT");
    return queued;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueApprovedDocsMissingExtraction(limit = 100) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `
      WITH candidates AS (
        SELECT
          'case_documents'::text AS source_table,
          id::bigint AS document_id,
          file_url,
          case_id::bigint AS case_id,
          NULL::bigint AS user_id
        FROM public.case_documents
        WHERE LOWER(status) = 'approved'
          AND (extraction_status IS NULL OR extraction_status <> 'DONE')

        UNION ALL

        SELECT
          'client_documents'::text AS source_table,
          id::bigint AS document_id,
          file_url,
          NULL::bigint AS case_id,
          user_id::bigint AS user_id
        FROM public.client_documents
        WHERE LOWER(status) = 'approved'
          AND (extraction_status IS NULL OR extraction_status <> 'DONE')
      )
      SELECT source_table, document_id, file_url, case_id, user_id
      FROM candidates
      LIMIT $1
      `,
      [Number(limit) || 100]
    );

    return await enqueueDocumentExtractionJobs(rows);
  } finally {
    client.release();
  }
}

function retryDelayMinutes(attempts) {
  if (attempts <= 1) return 2;
  if (attempts === 2) return 10;
  return 30;
}

export async function processExtractionQueue(batchSize = 5) {
  const client = await pool.connect();
  let jobs = [];

  try {
    await client.query("BEGIN");
    const lockRes = await client.query(
      `
      SELECT id, source_table, document_id, file_url, attempts, max_attempts
      FROM public.document_extraction_jobs
      WHERE status = 'PENDING'
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC, id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [Number(batchSize) || 5]
    );

    jobs = lockRes.rows;
    if (jobs.length === 0) {
      await client.query("COMMIT");
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    for (const job of jobs) {
      await client.query(
        `
        UPDATE public.document_extraction_jobs
        SET status = 'PROCESSING', locked_at = NOW(), updated_at = NOW()
        WHERE id = $1
        `,
        [job.id]
      );

      await client.query(
        `
        UPDATE public.${targetTableOrThrow(job.source_table)}
        SET extraction_status = 'PROCESSING', extraction_updated_at = NOW()
        WHERE id = $1
        `,
        [job.document_id]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const sourceTable = targetTableOrThrow(job.source_table);
    const attempts = Number(job.attempts || 0) + 1;

    try {
      const extractedText = await extractTextForDocument(job.file_url);

      await pool.query(
        `
        UPDATE public.${sourceTable}
        SET
          extracted_text = $2,
          extraction_status = 'DONE',
          extraction_error = NULL,
          extraction_attempts = $3,
          extracted_text_at = NOW(),
          extraction_updated_at = NOW()
        WHERE id = $1
        `,
        [job.document_id, extractedText || null, attempts]
      );

      await pool.query(
        `
        UPDATE public.document_extraction_jobs
        SET
          status = 'DONE',
          attempts = $2,
          last_error = NULL,
          locked_at = NULL,
          updated_at = NOW()
        WHERE id = $1
        `,
        [job.id, attempts]
      );

      succeeded += 1;
    } catch (error) {
      const message = String(error?.message || error || "Extraction failed").slice(0, 4000);
      const maxAttempts = Number(job.max_attempts || 3);
      const exhausted = attempts >= maxAttempts;

      await pool.query(
        `
        UPDATE public.${sourceTable}
        SET
          extraction_status = $2,
          extraction_error = $3,
          extraction_attempts = $4,
          extraction_updated_at = NOW()
        WHERE id = $1
        `,
        [job.document_id, exhausted ? "FAILED" : "PENDING", message, attempts]
      );

      if (exhausted) {
        await pool.query(
          `
          UPDATE public.document_extraction_jobs
          SET
            status = 'FAILED',
            attempts = $2,
            last_error = $3,
            locked_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          `,
          [job.id, attempts, message]
        );
      } else {
        await pool.query(
          `
          UPDATE public.document_extraction_jobs
          SET
            status = 'PENDING',
            attempts = $2,
            last_error = $3,
            next_run_at = NOW() + make_interval(mins => $4::int),
            locked_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          `,
          [job.id, attempts, message, retryDelayMinutes(attempts)]
        );
      }

      failed += 1;
    }
  }

  return { processed: jobs.length, succeeded, failed };
}

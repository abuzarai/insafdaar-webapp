import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { enqueueDocumentExtractionJobs } from "../services/documentExtraction.service.js";

const router = express.Router();

const UPLOAD_DIR = path.resolve("uploads/documents");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeType = (req.body.docType || "DOC").replace(/[^A-Z_]/gi, "");
    cb(null, `${safeType}_${req.user.id}_${Date.now()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(
      new Error("Only PNG/JPG/WEBP images or PDF files are allowed."),
      false
    );
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const VALID_DOC_TYPES = new Set(["CNIC_FRONT", "CNIC_BACK", "ADDRESS_PROOF"]);

router.post(
  "/documents",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const { docType } = req.body;

      if (!VALID_DOC_TYPES.has(docType)) {
        return res.status(400).json({ error: "Invalid docType" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file received" });
      }

      const fileUrl = `/uploads/documents/${req.file.filename}`;

      // ✅ insert document
      const result = await pool.query(
        `
        INSERT INTO client_documents (user_id, doc_type, file_url, status)
        VALUES ($1, $2, $3, 'PENDING_VERIFICATION')
        RETURNING id, doc_type, file_url, status, created_at
        `,
        [req.user.id, docType, fileUrl]
      );

      await enqueueDocumentExtractionJobs([
        {
          source_table: "client_documents",
          document_id: result.rows[0].id,
          file_url: result.rows[0].file_url,
          user_id: req.user.id,
          case_id: null,
        },
      ]).catch((e) => {
        console.error("enqueueDocumentExtractionJobs(client_documents):", e?.message || e);
      });

      // ✅ keep your existing profile status updates
      if (docType === "CNIC_FRONT" || docType === "CNIC_BACK") {
        await pool.query(
          `
          INSERT INTO client_profiles (user_id, identity_doc_status)
          VALUES ($1, 'PENDING_VERIFICATION')
          ON CONFLICT (user_id)
          DO UPDATE SET identity_doc_status = 'PENDING_VERIFICATION', updated_at = NOW()
          `,
          [req.user.id]
        );
      }

      if (docType === "ADDRESS_PROOF") {
        await pool.query(
          `
          INSERT INTO client_profiles (user_id, address_proof_status)
          VALUES ($1, 'PENDING_VERIFICATION')
          ON CONFLICT (user_id)
          DO UPDATE SET address_proof_status = 'PENDING_VERIFICATION', updated_at = NOW()
          `,
          [req.user.id]
        );
      }

      // =====================================================
      // ✅ STEP 3 — check all 3 docs & update documents_completed
      // =====================================================
      const docsRes = await pool.query(
        `SELECT DISTINCT doc_type FROM public.client_documents WHERE user_id=$1`,
        [req.user.id]
      );

      const uploaded = docsRes.rows.map((r) => r.doc_type);

      const docsCompleted =
        uploaded.includes("CNIC_FRONT") &&
        uploaded.includes("CNIC_BACK") &&
        uploaded.includes("ADDRESS_PROOF");

      // Ensure profile row exists, then update flag
      await pool.query(
        `
        INSERT INTO public.client_profiles (user_id, documents_completed)
        VALUES ($1, $2)
        ON CONFLICT (user_id)
        DO UPDATE SET documents_completed = EXCLUDED.documents_completed, updated_at = NOW()
        `,
        [req.user.id, docsCompleted]
      );
      // =====================================================

      return res.json({
        message: "Uploaded",
        document: result.rows[0],
        documentsCompleted: docsCompleted,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
);

router.get("/documents", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, doc_type, file_url, status, created_at
      FROM client_documents
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

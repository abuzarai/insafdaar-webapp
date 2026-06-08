import express from "express";

import pool from "../db.js";
import { internalOnly } from "../middleware/internalOnly.js";

const router = express.Router();

router.use(internalOnly);

router.post("/case-context", async (req, res) => {
  try {
    const caseId = Number(req.body?.case_id);
    const advocateId = Number(req.body?.advocate_id);
    if (!caseId || !advocateId) {
      return res.status(400).json({ error: "case_id and advocate_id are required" });
    }

    const result = await pool.query(
      `
      SELECT
        cc.*,
        cu.name AS name,
        cu.email AS email,
        cu.name AS client_name,
        cu.email AS client_email,
        cp.phone AS client_phone,
        cp.cnic AS client_cnic,
        cp.city AS client_city,
        cp.address AS client_address,
        au.name AS advocate_name,
        au.email AS advocate_email,
        ap.phone AS advocate_phone,
        ap.bar_council_id AS advocate_bar_council_id,
        ap.headline AS advocate_headline,
        ap.city AS advocate_city,
        ap.court AS advocate_court
      FROM public.client_cases cc
      JOIN public.users cu ON cc.user_id = cu.id
      LEFT JOIN public.users au ON cc.assigned_advocate_id = au.id
      LEFT JOIN public.client_profiles cp ON cp.user_id = cc.user_id
      LEFT JOIN public.advocate_profiles ap ON ap.user_id = cc.assigned_advocate_id
      WHERE cc.id = $1 AND cc.assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    if (!result.rowCount) {
      const exists = await pool.query("SELECT 1 FROM public.client_cases WHERE id = $1", [caseId]);
      if (!exists.rowCount) return res.status(404).json({ error: "Case not found" });
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/intake-analysis", async (req, res) => {
  try {
    const caseId = Number(req.body?.case_id);
    if (!caseId) {
      return res.status(400).json({ error: "case_id is required" });
    }

    const result = await pool.query(
      `
      SELECT analysis, transcript
      FROM public.case_intake_sessions
      WHERE case_id = $1 AND LOWER(status) = 'completed'
      ORDER BY id DESC
      LIMIT 1
      `,
      [caseId]
    );

    if (!result.rowCount) {
      return res.json({ analysis: null, transcript: null });
    }

    return res.json({
      analysis: result.rows[0].analysis ?? null,
      transcript: result.rows[0].transcript ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/documents", async (req, res) => {
  try {
    const caseId = Number(req.body?.case_id);
    const userId = Number(req.body?.user_id);
    const advocateId = Number(req.body?.advocate_id);
    if (!caseId || !userId || !advocateId) {
      return res.status(400).json({ error: "case_id, user_id and advocate_id are required" });
    }

    const access = await pool.query(
      `
      SELECT 1
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    if (!access.rowCount) {
      const exists = await pool.query("SELECT 1 FROM public.client_cases WHERE id = $1", [caseId]);
      if (!exists.rowCount) return res.status(404).json({ error: "Case not found" });
      return res.status(403).json({ error: "Forbidden" });
    }

    const [caseDocs, clientDocs] = await Promise.all([
      pool.query(
        `
        SELECT id, doc_type, file_url, status, extracted_text, extraction_status, created_at, updated_at,
               'case'::text AS source
        FROM public.case_documents
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC
        `,
        [caseId]
      ),
      pool.query(
        `
        SELECT id, doc_type, file_url, status, extracted_text, extraction_status, created_at, updated_at,
               'client'::text AS source
        FROM public.client_documents
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        `,
        [userId]
      ),
    ]);

    return res.json({
      case_documents: caseDocs.rows,
      client_documents: clientDocs.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/save", async (req, res) => {
  try {
    const caseId = Number(req.body?.case_id);
    const advocateId = Number(req.body?.advocate_id);
    const documentType = String(req.body?.document_type || "").trim();
    const generationId = String(req.body?.generation_id || "").trim();
    const draftJson = req.body?.draft_json;

    if (!caseId || !advocateId || !documentType || !generationId || !draftJson) {
      return res.status(400).json({ error: "case_id, advocate_id, document_type, generation_id, draft_json are required" });
    }

    const access = await pool.query(
      `
      SELECT 1
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );
    if (!access.rowCount) {
      const exists = await pool.query("SELECT 1 FROM public.client_cases WHERE id = $1", [caseId]);
      if (!exists.rowCount) return res.status(404).json({ error: "Case not found" });
      return res.status(403).json({ error: "Forbidden" });
    }

    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS public.draft_sessions (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        document_type TEXT NOT NULL,
        generation_id TEXT UNIQUE NOT NULL,
        draft_json JSONB NOT NULL,
        advocate_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
      )
      `
    );

    await pool.query(
      `
      INSERT INTO public.draft_sessions
        (case_id, document_type, generation_id, draft_json, advocate_id)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (generation_id) DO UPDATE
      SET case_id = EXCLUDED.case_id,
          document_type = EXCLUDED.document_type,
          draft_json = EXCLUDED.draft_json,
          advocate_id = EXCLUDED.advocate_id,
          updated_at = NOW()
      `,
      [caseId, documentType, generationId, JSON.stringify(draftJson), advocateId]
    );

    return res.json({ saved: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

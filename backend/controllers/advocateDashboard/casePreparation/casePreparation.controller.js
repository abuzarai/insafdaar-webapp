import pool from "../../../db.js";
import { enqueueDocumentExtractionJobs } from "../../../services/documentExtraction.service.js";
import { createClientNotification } from "../../clientDashboard/notifications/notifications.controller.js";
import PDFDocument from "pdfkit";
import { getDraftingAssistantBaseUrl, callDraftingAssistant, fetchDraftJob } from "../../../services/draftingClient.js";

async function assertCaseAssignedAndActive(caseId, advocateId) {
  const caseRes = await pool.query(
    `
    SELECT id, status
    FROM public.client_cases
    WHERE id = $1 AND assigned_advocate_id = $2
    LIMIT 1
    `,
    [caseId, advocateId]
  );

  const caseRow = caseRes.rows[0];
  if (!caseRow) {
    return { ok: false, status: 404, payload: { error: "Case not found" } };
  }

  const activeCheck = assertCaseActiveStatus(caseRow.status);
  if (!activeCheck.ok) {
    return { ok: false, status: activeCheck.status, payload: activeCheck.payload };
  }

  return { ok: true, caseRow };
}

/* ================= Helpers ================= */

function normalizeCaseId(caseIdParam) {
  const s = String(caseIdParam || "").trim();
  if (!s) return null;
  if (s.toUpperCase().startsWith("CASE-")) return Number(s.split("-")[1]);
  return Number(s);
}

const DEFAULT_CHECKLIST = [
  { doc_key: "CNIC_FRONT", title: "CNIC (Front)", is_required: true },
  { doc_key: "CNIC_BACK", title: "CNIC (Back)", is_required: true },
  { doc_key: "FIR_COPY", title: "Complaint / FIR Copy", is_required: true },
  { doc_key: "EVIDENCE", title: "Evidence / Supporting Documents", is_required: true },
  { doc_key: "AFFIDAVIT", title: "Affidavit (if required)", is_required: false },
  { doc_key: "POWER_OF_ATTORNEY", title: "Power of Attorney", is_required: false },
];

/* ================= Helpers ================= */

/* ================= Controllers ================= */

function assertCaseActiveStatus(caseStatus) {
  const status = String(caseStatus || "").toUpperCase();
  if (status !== "CASE_ACTIVE") {
    return {
      ok: false,
      status: 409,
      payload: {
        error: "CASE_NOT_ACTIVE",
        message: `Case preparation is available only after contract approval (CASE_ACTIVE). Current status: ${status || "UNKNOWN"}`,
        currentStatus: status || null,
      },
    };
  }
  return { ok: true };
}

/**
 * GET /api/advocate/dashboard/case-preparation/cases/accepted
 * Advocate accepted cases (dropdown filter)
 */
export async function listAcceptedCasesForAdvocate(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.title,
        c.status,
        u.name  AS client_name,
        u.email AS client_email,
        cp.phone AS client_phone
      FROM public.client_cases c
      JOIN public.users u ON u.id = c.user_id
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      WHERE c.assigned_advocate_id = $1
        AND c.status = 'CASE_ACTIVE'
      ORDER BY c.updated_at DESC, c.created_at DESC
      `,
      [advocateId]
    );

    return res.json({
      cases: rows.map((r) => ({
        id: `CASE-${r.id}`,
        title: r.title || "—",
        status: r.status,
        client: {
          name: r.client_name,
          email: r.client_email,
          phone: r.client_phone || null,
        },
      })),
    });
  } catch (err) {
    console.error("listAcceptedCasesForAdvocate:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/advocate/dashboard/case-preparation/:caseId
 * Full preparation details
 */
export async function getCasePreparationDetails(req, res) {
  const client = await pool.connect();
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    await client.query("BEGIN");

    // 1) Validate case ownership
    const caseRes = await client.query(
      `
      SELECT
        c.id,
        c.title,
        c.status,
        c.user_id AS client_id,
        u.name  AS client_name,
        u.email AS client_email,
        cp.phone AS client_phone
      FROM public.client_cases c
      JOIN public.users u ON u.id = c.user_id
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      WHERE c.id = $1 AND c.assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    const caseRow = caseRes.rows[0];
    if (!caseRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    const activeCheck = assertCaseActiveStatus(caseRow.status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    // 2) Ensure preparation row exists
    let prepRes = await client.query(
      `
      SELECT id, status, notes
      FROM public.case_preparation
      WHERE case_id = $1 AND advocate_id = $2
      `,
      [caseId, advocateId]
    );

    let preparationId = prepRes.rows[0]?.id;

    if (!preparationId) {
      const created = await client.query(
        `
        INSERT INTO public.case_preparation (case_id, advocate_id)
        VALUES ($1, $2)
        RETURNING id, status, notes
        `,
        [caseId, advocateId]
      );
      preparationId = created.rows[0].id;
      prepRes = created;
    }

    // 3) Seed checklist if empty
    const { rows: countRows } = await client.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM public.case_preparation_items
      WHERE preparation_id = $1
      `,
      [preparationId]
    );

    if (countRows[0].cnt === 0) {
      const values = [];
      const params = [];
      let i = 1;

      for (const item of DEFAULT_CHECKLIST) {
        params.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
        values.push(preparationId, item.doc_key, item.title, item.is_required);
      }

      await client.query(
        `
        INSERT INTO public.case_preparation_items
          (preparation_id, doc_key, title, is_required)
        VALUES ${params.join(",")}
        `,
        values
      );
    }

    // 4) Load checklist
    const itemsRes = await client.query(
      `
      SELECT
        id,
        doc_key,
        title,
        is_required,
        is_provided,
        provided_doc_id,
        updated_at
      FROM public.case_preparation_items
      WHERE preparation_id = $1
      ORDER BY is_required DESC, id ASC
      `,
      [preparationId]
    );

    // 5) Load case + client documents shown in preparation UI
    const docsRes = await client.query(
      `
      SELECT *
      FROM (
        SELECT
          id,
          doc_type,
          file_url,
          status,
          note,
          created_at,
          'case'::text AS source
        FROM public.case_documents
        WHERE case_id = $1

        UNION ALL

        SELECT
          id,
          doc_type,
          file_url,
          status,
          NULL::text AS note,
          created_at,
          'client'::text AS source
        FROM public.client_documents
        WHERE user_id = $2
      ) docs
      ORDER BY created_at DESC, id DESC
      `,
      [caseId, caseRow.client_id]
    );

    await client.query("COMMIT");

    return res.json({
      case: {
        id: `CASE-${caseRow.id}`,
        title: caseRow.title,
        status: caseRow.status,
      },
      client: {
        id: caseRow.client_id,
        name: caseRow.client_name,
        email: caseRow.client_email,
        phone: caseRow.client_phone || null,
      },
      documents: docsRes.rows,
      preparation: {
        id: preparationId,
        status: prepRes.rows[0].status,
        notes: prepRes.rows[0].notes,
        items: itemsRes.rows,
      },
      aiDraft: {
        status: "PLACEHOLDER",
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("getCasePreparationDetails:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/advocate/dashboard/case-preparation/:caseId/documents/:documentId/status
 * Body: { status: string, source?: "case" | "client" }
 */
export async function updatePreparationDocumentStatus(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    const documentId = Number(req.params.documentId);
    const source = String(req.body?.source || "case").toLowerCase();
    const status = String(req.body?.status || "").trim();

    if (!caseId || !documentId || !status) {
      return res.status(400).json({ error: "caseId, documentId and status are required" });
    }

    if (source !== "case" && source !== "client") {
      return res.status(400).json({ error: "source must be 'case' or 'client'" });
    }

    const allowed = new Set(["UPLOADED", "PENDING_VERIFICATION", "NEEDS_REVIEW", "APPROVED", "REJECTED"]);
    if (!allowed.has(status.toUpperCase())) {
      return res.status(400).json({ error: "Unsupported status value" });
    }

    const caseRes = await pool.query(
      `
      SELECT id, status, user_id AS client_id
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    const caseRow = caseRes.rows[0];
    if (!caseRow) return res.status(404).json({ error: "Case not found" });

    const activeCheck = assertCaseActiveStatus(caseRow.status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    let updateRes;
    if (source === "case") {
      updateRes = await pool.query(
        `
        UPDATE public.case_documents
        SET status = $3, updated_at = NOW()
        WHERE id = $1 AND case_id = $2
        RETURNING id, doc_type, file_url, status, created_at, updated_at, 'case'::text AS source
        `,
        [documentId, caseId, status]
      );
    } else {
      updateRes = await pool.query(
        `
        UPDATE public.client_documents
        SET status = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, doc_type, file_url, status, created_at, updated_at, 'client'::text AS source
        `,
        [documentId, caseRow.client_id, status]
      );
    }

    const doc = updateRes.rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (String(status).toUpperCase() === "APPROVED") {
      await enqueueDocumentExtractionJobs([
        {
          source_table: source === "case" ? "case_documents" : "client_documents",
          document_id: doc.id,
          file_url: doc.file_url,
          case_id: source === "case" ? caseId : null,
          user_id: source === "client" ? caseRow.client_id : null,
        },
      ]).catch((e) => {
        console.error("enqueueDocumentExtractionJobs(updatePreparationDocumentStatus):", e?.message || e);
      });
    }

    return res.json({ document: doc });
  } catch (err) {
    console.error("updatePreparationDocumentStatus:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * PATCH /api/advocate/dashboard/case-preparation/:caseId/items
 * Tick / untick checklist
 */
export async function updatePreparationItem(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    const { doc_key, is_provided, provided_doc_id = null } = req.body;

    if (!doc_key || typeof is_provided !== "boolean") {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const statusCheck = await pool.query(
      `
      SELECT c.status
      FROM public.client_cases c
      WHERE c.id = $1 AND c.assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    if (!statusCheck.rows[0]) return res.status(404).json({ error: "Case not found" });

    const activeCheck = assertCaseActiveStatus(statusCheck.rows[0].status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const { rows } = await pool.query(
      `
      UPDATE public.case_preparation_items i
      SET
        is_provided = $1,
        provided_doc_id = $2,
        updated_by = $3,
        updated_at = NOW()
      FROM public.case_preparation p
      WHERE
        p.id = i.preparation_id
        AND p.case_id = $4
        AND p.advocate_id = $3
        AND i.doc_key = $5
      RETURNING i.*
      `,
      [is_provided, provided_doc_id, advocateId, caseId, doc_key]
    );

    if (!rows[0]) return res.status(404).json({ error: "Checklist item not found" });

    return res.json({ item: rows[0] });
  } catch (err) {
    console.error("updatePreparationItem:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/advocate/dashboard/case-preparation/:caseId/request-docs
 * Email request + log
 */
export async function requestMissingDocsEmail(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    const { missing_doc_keys = [], message = "" } = req.body;

    if (!Array.isArray(missing_doc_keys) || missing_doc_keys.length === 0) {
      return res.status(400).json({ error: "missing_doc_keys required" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        c.id,
        c.status,
        c.user_id AS client_id,
        u.email,
        u.name
      FROM public.client_cases c
      JOIN public.users u ON u.id = c.user_id
      WHERE c.id = $1 AND c.assigned_advocate_id = $2
      `,
      [caseId, advocateId]
    );

    if (!rows[0]) return res.status(404).json({ error: "Case not found" });

    const activeCheck = assertCaseActiveStatus(rows[0].status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const subject = `Documents required for CASE-${rows[0].id}`;
    const body = `
Missing documents:
${missing_doc_keys.join(", ")}

${message}
`;

    await pool.query(
      `
      INSERT INTO public.case_preparation_messages
        (case_id, advocate_id, client_id, subject, body, sent_to)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [caseId, advocateId, rows[0].client_id, subject, body, rows[0].email]
    );

    await createClientNotification({
      userId: Number(rows[0].client_id),
      caseId: Number(caseId),
      title: `Documents requested for CASE-${rows[0].id}`,
      description: `Requested: ${missing_doc_keys.join(", ")}${message ? `\n\nNote: ${message}` : ""}`,
      type: "Document",
      priority: "High",
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("requestMissingDocsEmail:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * PATCH /api/advocate/dashboard/case-preparation/:caseId/complete
 */
export async function markPreparationComplete(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const caseStatusRes = await pool.query(
      `
      SELECT c.status
      FROM public.client_cases c
      WHERE c.id = $1
        AND c.assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    if (!caseStatusRes.rows[0]) return res.status(404).json({ error: "Case not found" });

    const activeCheck = assertCaseActiveStatus(caseStatusRes.rows[0].status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const { rows } = await pool.query(
      `
      UPDATE public.case_preparation
      SET status = 'COMPLETED', updated_at = NOW()
      WHERE case_id = $1 AND advocate_id = $2
      RETURNING *
      `,
      [caseId, advocateId]
    );

    if (!rows[0]) return res.status(404).json({ error: "Preparation not found" });

    return res.json({ preparation: rows[0] });
  } catch (err) {
    console.error("markPreparationComplete:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/advocate/dashboard/case-preparation/:caseId/documents/upload
 * Body (multipart/form-data): file, docType?, note?
 */
export async function uploadPreparationCaseDocument(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    const docType = String(req.body?.docType || "OTHER").trim() || "OTHER";
    const noteRaw = String(req.body?.note || "").trim();
    const note = noteRaw ? noteRaw.slice(0, 1000) : null;

    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const caseRes = await pool.query(
      `
      SELECT id, status, user_id AS client_id
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    const caseRow = caseRes.rows[0];
    if (!caseRow) return res.status(404).json({ error: "Case not found" });

    const activeCheck = assertCaseActiveStatus(caseRow.status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const fileUrl = `/uploads/case-documents/${req.file.filename}`;

    const ins = await pool.query(
      `
      INSERT INTO public.case_documents (case_id, doc_type, file_url, status, note)
      VALUES ($1, $2, $3, 'UPLOADED', $4)
      RETURNING id, case_id, doc_type, file_url, status, note, created_at, updated_at
      `,
      [caseId, docType, fileUrl, note]
    );

    const uploadedDoc = ins.rows[0];

    await enqueueDocumentExtractionJobs([
      {
        source_table: "case_documents",
        document_id: uploadedDoc.id,
        file_url: uploadedDoc.file_url,
        case_id: Number(caseId),
        user_id: null,
      },
    ]).catch((e) => {
      console.error("enqueueDocumentExtractionJobs(uploadPreparationCaseDocument):", e?.message || e);
    });

    await createClientNotification({
      userId: Number(caseRow.client_id),
      caseId: Number(caseId),
      title: `New document uploaded for CASE-${caseId}`,
      description: `Your lawyer uploaded ${docType}${note ? `. Note: ${note}` : ""}`,
      type: "Document",
      priority: "Medium",
    });

    return res.status(201).json({ document: uploadedDoc });
  } catch (err) {
    console.error("uploadPreparationCaseDocument:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/advocate/dashboard/case-preparation/:caseId/ai-draft/generate
 * Body: { document_type: string, advocate_notes?: string, language?: string }
 */
export async function generatePreparationAIDraft(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const documentType = String(req.body?.document_type || "").trim();
    const advocateNotes = String(req.body?.advocate_notes || "").trim();
    const language = String(req.body?.language || "English").trim() || "English";

    if (!documentType) {
      return res.status(400).json({ error: "document_type is required" });
    }

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    // Submit the generation as a background job: the request returns fast
    // with a job id, and the frontend polls GET .../ai-draft/jobs/:jobId.
    const queued = await callDraftingAssistant(
      "/draft/generate",
      {
        case_id: Number(caseId),
        advocate_id: Number(advocateId),
        document_type: documentType,
        advocate_notes: advocateNotes,
        language,
      },
      true,
      20000
    );
    if (!queued.ok) return res.status(queued.status).json(queued.payload);
    const jobId = queued.data?.job_id;
    if (!jobId) {
      return res.status(502).json({ error: "Drafting service did not return a job id" });
    }
    console.info("[AI-DRAFT] generate:queued", {
      caseId: Number(caseId),
      advocateId: Number(advocateId),
      documentType,
      jobId,
    });
    return res.json({ ok: true, job_id: jobId, status: "queued" });
  } catch (err) {
    console.error("generatePreparationAIDraft:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/advocate/dashboard/case-preparation/:caseId/ai-draft/jobs/:jobId
 * Polls the drafting service job; returns the generated draft when done.
 */
export async function getPreparationAIDraftStatus(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const st = await fetchDraftJob(jobId);
    if (!st.ok) {
      if (st.status === 404) {
        return res.status(410).json({ error: "Draft job expired. Please generate again." });
      }
      return res.status(st.status || 502).json(st.payload || { error: "Failed to check draft status" });
    }

    const body = st.data;
    if (body.status === "succeeded") {
      const data = body.result || {};
      return res.json({
        ok: true,
        status: "succeeded",
        document_type: data?.document_type || "",
        draft: data?.draft || null,
        generation_id: data?.generation_id || null,
        legal_references_used: Array.isArray(data?.legal_references_used)
          ? data.legal_references_used
          : [],
      });
    }
    if (body.status === "failed") {
      return res.status(502).json({ error: body.error || "Draft generation failed" });
    }
    return res.json({ ok: true, status: body.status || "queued" });
  } catch (err) {
    console.error("getPreparationAIDraftStatus:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function regeneratePreparationAIDraftSection(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const generationId = String(req.body?.generation_id || "").trim();
    const sectionId = String(req.body?.section_id || "").trim();
    const instruction = String(req.body?.instruction || "").trim();
    const documentType = String(req.body?.document_type || "").trim();
    const language = String(req.body?.language || "English").trim() || "English";
    const currentDraft = req.body?.current_draft;

    if (!generationId || !sectionId || !instruction || !documentType || !currentDraft) {
      return res.status(400).json({
        error: "generation_id, section_id, instruction, document_type, current_draft are required",
      });
    }

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    const upstreamCall = await callDraftingAssistant("/draft/regenerate-section", {
      generation_id: generationId,
      section_id: sectionId,
      instruction,
      case_id: Number(caseId),
      advocate_id: Number(advocateId),
      document_type: documentType,
      language,
      current_draft: currentDraft,
    });
    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    return res.json({
      ok: true,
      section: {
        id: String(upstreamCall.data?.section_id || sectionId),
        heading: String(upstreamCall.data?.heading || ""),
        content: String(upstreamCall.data?.content || ""),
      },
    });
  } catch (err) {
    console.error("regeneratePreparationAIDraftSection:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function savePreparationAIDraft(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const generationId = String(req.body?.generation_id || "").trim();
    const documentType = String(req.body?.document_type || "").trim();
    const draft = req.body?.draft;

    if (!generationId || !documentType || !draft) {
      return res.status(400).json({ error: "generation_id, document_type, draft are required" });
    }

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    const upstreamCall = await callDraftingAssistant("/draft/save", {
      case_id: Number(caseId),
      advocate_id: Number(advocateId),
      generation_id: generationId,
      document_type: documentType,
      draft,
    });
    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    return res.json({ ok: true, saved: Boolean(upstreamCall.data?.saved) });
  } catch (err) {
    console.error("savePreparationAIDraft:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function exportPreparationAIDraftDocx(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const documentType = String(req.body?.document_type || "").trim();
    const draft = req.body?.draft;

    if (!documentType || !draft) {
      return res.status(400).json({ error: "document_type and draft are required" });
    }

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    const upstreamCall = await callDraftingAssistant(
      "/draft/export",
      {
        case_id: Number(caseId),
        document_type: documentType,
        final_draft: draft,
        format: "docx",
      },
      false
    );

    if (!upstreamCall.ok) return res.status(upstreamCall.status).json(upstreamCall.payload);

    const upstream = upstreamCall.upstream;
    const buf = Buffer.from(await upstream.arrayBuffer());
    const fileName = `${documentType}_${caseId}.docx`.replace(/\s+/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return res.send(buf);
  } catch (err) {
    console.error("exportPreparationAIDraftDocx:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function exportPreparationAIDraftPdf(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const documentType = String(req.body?.document_type || "").trim();
    const draft = req.body?.draft;
    if (!documentType || !draft?.title || !Array.isArray(draft?.sections)) {
      return res.status(400).json({ error: "document_type and draft with sections are required" });
    }

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    const fileName = `${documentType}_${caseId}.pdf`.replace(/\s+/g, "_");
    const pdf = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    pdf.pipe(res);

    pdf.fontSize(18).text(String(draft.title), { align: "center" });
    pdf.moveDown(0.5);
    pdf.fontSize(10).fillColor("#666").text(`Case: CASE-${caseId}   Document: ${documentType}`, { align: "center" });
    pdf.fillColor("#000");
    pdf.moveDown(1.2);

    for (const sec of draft.sections) {
      pdf.fontSize(13).font("Helvetica-Bold").text(String(sec?.heading || "Section"));
      pdf.moveDown(0.3);
      pdf.fontSize(11).font("Helvetica").text(String(sec?.content || ""), {
        align: "justify",
        lineGap: 2,
      });
      pdf.moveDown(1);
    }

    pdf.end();
  } catch (err) {
    console.error("exportPreparationAIDraftPdf:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getPreparationLatestAIDraft(req, res) {
  try {
    const advocateId = req.user?.id;
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const documentType = String(req.query?.document_type || "").trim();

    const access = await assertCaseAssignedAndActive(caseId, advocateId);
    if (!access.ok) return res.status(access.status).json(access.payload);

    const values = [Number(caseId), Number(advocateId)];
    let where = "case_id = $1 AND advocate_id = $2";
    if (documentType) {
      values.push(documentType);
      where += ` AND LOWER(document_type) = LOWER($${values.length})`;
    }

    const q = await pool.query(
      `
      SELECT generation_id, document_type, draft_json, updated_at
      FROM public.draft_sessions
      WHERE ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      values
    );

    const row = q.rows[0];
    if (!row) return res.json({ ok: true, draft: null });

    return res.json({
      ok: true,
      generation_id: row.generation_id,
      document_type: row.document_type,
      draft: row.draft_json,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error("getPreparationLatestAIDraft:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

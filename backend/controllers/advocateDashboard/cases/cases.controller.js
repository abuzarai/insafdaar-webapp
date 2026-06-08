import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => toStringOrNull(v))
      .filter(Boolean)
      .slice(0, 8);
  }

  const raw = toStringOrNull(value);
  if (!raw) return [];

  return raw
    .split(/\n|\||;|,/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeInterviewSummary(analysis) {
  const a = toObject(analysis);

  return {
    primaryLanguage: toStringOrNull(a.primary_language),
    legalDomain: toStringOrNull(a.legal_domain),
    issueSummary: toStringOrNull(a.issue_summary),
    urgency: toStringOrNull(a.urgency),
    urgencyReasoning: toStringOrNull(a.urgency_reasoning),
    adrSuitable: typeof a.adr_suitable === "boolean" ? a.adr_suitable : null,
    adrReasoning: toStringOrNull(a.adr_reasoning),
    confidenceScore: toNumberOrNull(a.confidence_score),
    keyEntities: {
      parties: toStringList(a?.key_entities?.parties),
      locations: toStringList(a?.key_entities?.locations),
      dates: toStringList(a?.key_entities?.dates),
      amounts: toStringList(a?.key_entities?.amounts),
    },
  };
}

async function getLatestInterviewResult(caseId) {
  const r = await pool.query(
    `
      SELECT
        id,
        mode,
        provider,
        status,
        language,
        transcript,
        analysis,
        audio_url,
        audio_duration,
        completion_source,
        result_hash,
        webhook_received_at,
        fallback_received_at,
        completed_at,
        updated_at,
        created_at
      FROM public.case_intake_sessions
      WHERE case_id = $1
      ORDER BY completed_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 1
    `,
    [Number(caseId)]
  );

  if (!r.rows[0]) return null;

  const row = r.rows[0];
  return {
    sessionId: Number(row.id),
    meta: {
      mode: row.mode || null,
      provider: row.provider || null,
      status: row.status || null,
      language: row.language || null,
      completedAt: row.completed_at || null,
      updatedAt: row.updated_at || null,
      audioUrl: row.audio_url || null,
      audioDuration: row.audio_duration || null,
      completionSource: row.completion_source || null,
      resultHash: row.result_hash || null,
      webhookReceivedAt: row.webhook_received_at || null,
      fallbackReceivedAt: row.fallback_received_at || null,
    },
    summary: normalizeInterviewSummary(row.analysis),
    transcript: row.transcript || null,
    analysis: row.analysis || null,
  };
}

/* =========================
   Get assigned cases
========================= */
export async function getAssignedCases(req, res) {
  try {
    const advocateId = req.user.id;

    const result = await pool.query(
      `
      SELECT id, title, status
      FROM public.client_cases
      WHERE assigned_advocate_id = $1
      ORDER BY created_at DESC
      `,
      [advocateId]
    );

    // ✅ Always return array
    return res.json({ cases: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/* =========================
   Get basic case details
========================= */
export async function getCaseDetails(req, res) {
  try {
    const { caseId } = req.params;
    const advocateId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        id,
        title,
        description,
        status,
        source,
        language,
        created_at,
        updated_at,
        user_id AS client_user_id,
        assigned_advocate_id
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      `,
      [caseId, advocateId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Case not found" });
    }

    return res.json({ case: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/* =========================
   FULL CASE (docs + voice)
========================= */
export async function getCaseFull(req, res) {
  try {
    const { caseId } = req.params;
    const advocateId = req.user.id;

    // 1️⃣ Case + client info
    const caseR = await pool.query(
      `
      SELECT
        c.*,
        u.name AS client_name,
        u.email AS client_email
      FROM public.client_cases c
      JOIN public.users u ON u.id = c.user_id
      WHERE c.id = $1 AND c.assigned_advocate_id = $2
      `,
      [caseId, advocateId]
    );

    if (!caseR.rowCount) {
      return res.status(404).json({ message: "Case not found or access denied" });
    }

    const caseRow = caseR.rows[0];

    // 2️⃣ Client documents
    const clientDocs = await pool.query(
      `
      SELECT id, doc_type, file_url, status, created_at
      FROM public.client_documents
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [caseRow.user_id]
    );

    // 3️⃣ Case documents
    const caseDocs = await pool.query(
      `
      SELECT id, doc_type, file_url, status, created_at
      FROM public.case_documents
      WHERE case_id = $1
      ORDER BY created_at DESC
      `,
      [caseId]
    );

    // 4️⃣ Voice notes
    const voiceNotes = await pool.query(
      `
      SELECT id, language, audio_url, notes, created_at
      FROM public.case_voice_notes
      WHERE case_id = $1
      ORDER BY created_at DESC
      `,
      [caseId]
    );

    const interview = await getLatestInterviewResult(caseId);

    return res.json({
      case: caseRow,
      clientDocuments: clientDocs.rows,
      caseDocuments: caseDocs.rows,
      voiceNotes: voiceNotes.rows,
      interview,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/* =========================
   Accept case
========================= */
export async function acceptCase(req, res) {
  const client = await pool.connect();
  try {
    const { caseId } = req.params;
    const advocateId = req.user.id;

    await client.query("BEGIN");

    const locked = await client.query(
      `
      SELECT id, title, status
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      FOR UPDATE
      `,
      [caseId, advocateId]
    );

    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Case not found or not assigned to you" });
    }

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.ACCEPTED,
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      reason: "Advocate accepted case",
      metadata: { action: "accept" },
    });

    await client.query("COMMIT");

    return res.json({
      message: "Case accepted successfully",
      case: {
        id: locked.rows[0].id,
        title: locked.rows[0].title,
        status: CASE_STATUS.ACCEPTED,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

export async function rejectCase(req, res) {
  const client = await pool.connect();
  try {
    const { caseId } = req.params;
    const advocateId = req.user.id;
    const reason = req.body?.reason ? String(req.body.reason).trim() : "Advocate rejected assignment";

    await client.query("BEGIN");

    const locked = await client.query(
      `
      SELECT id, title, status
      FROM public.client_cases
      WHERE id = $1 AND assigned_advocate_id = $2
      FOR UPDATE
      `,
      [caseId, advocateId]
    );

    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Case not found or not assigned to you" });
    }

    const upd = await client.query(
      `
      UPDATE public.client_cases
      SET assigned_advocate_id = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, title
      `,
      [caseId]
    );

    await transitionCaseStatus(client, {
      caseId,
      toStatus: CASE_STATUS.MATCHING_REVIEW,
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      reason,
      metadata: { action: "reject" },
    });

    await client.query("COMMIT");

    return res.json({
      message: "Case rejected. Sent back for admin reassignment.",
      case: {
        ...upd.rows[0],
        status: CASE_STATUS.MATCHING_REVIEW,
        assigned_advocate_id: null,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

export async function getCaseVouchers(req, res) {
  try {
    const { caseId } = req.params;
    const advocateId = req.user.id;

    const ownership = await pool.query(
      `
        SELECT id
        FROM public.client_cases
        WHERE id = $1 AND assigned_advocate_id = $2
      `,
      [caseId, advocateId]
    );

    if (!ownership.rowCount) {
      return res.status(404).json({ error: "Case not found or access denied" });
    }

    const vouchersR = await pool.query(
      `
        SELECT
          id,
          case_id,
          title,
          description,
          amount,
          status,
          due_date,
          voucher_pdf_url,
          is_installment,
          sequence_no,
          issued_at,
          verified_at,
          rejection_note,
          created_at,
          updated_at
        FROM public.client_billing
        WHERE case_id = $1
        ORDER BY sequence_no ASC, created_at ASC
      `,
      [caseId]
    );

    const paymentR = await pool.query(
      `
        SELECT
          id,
          payment_required_total,
          payment_verified_total,
          payment_status_computed,
          payment_status,
          payment_manual_override_status,
          payment_manual_override_note,
          payment_manual_override_at
        FROM public.client_cases
        WHERE id = $1
      `,
      [caseId]
    );

    return res.json({
      vouchers: vouchersR.rows,
      payment: paymentR.rows[0] || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load case vouchers" });
  }
}

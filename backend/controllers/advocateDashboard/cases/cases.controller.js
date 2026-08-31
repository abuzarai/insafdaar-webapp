import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";
import { getLatestInterviewResult } from "../../../utils/interviewMatching.js";







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

    const interview = await getLatestInterviewResult(pool, caseId);

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

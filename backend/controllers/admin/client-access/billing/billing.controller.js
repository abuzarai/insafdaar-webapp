import pool from "../../../../db.js";
import { notifyClient } from "../../../../utils/notify.js";
import { generateVoucherPdfForBillingId } from "../../../../utils/voucherPdf.js";
import { logCasePaymentEvent, recomputeCasePaymentRollup } from "../../../../utils/casePayments.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function requireAdmin(req, res) {
  const adminId = toInt(req.user?.id);
  if (!adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return adminId;
}

/**
 * POST /api/admin/client-access/billing/vouchers
 * Creates voucher record (admin enters payment/bank + optional case_id/advocate_id)
 */
export async function createVoucher(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const userId = toInt(req.body?.user_id);
    const title = String(req.body?.title || "Total Fee Voucher").trim();
    const description = String(req.body?.description || "").trim();

    const amountNum = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const bank_account_number = req.body?.bank_account_number
      ? String(req.body.bank_account_number).trim()
      : null;

    const bank_branch = req.body?.bank_branch
      ? String(req.body.bank_branch).trim()
      : null;

    const bank_name = req.body?.bank_name ? String(req.body.bank_name).trim() : null;

    const bank_account_title = req.body?.bank_account_title
      ? String(req.body.bank_account_title).trim()
      : null;

    const case_id = req.body?.case_id ? toInt(req.body.case_id) : null;
    const advocate_id = req.body?.advocate_id ? toInt(req.body.advocate_id) : null;

    let due_date = null;
    if (req.body?.due_date) {
      const d = new Date(req.body.due_date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid due_date" });
      }
      due_date = d;
    }

    if (!userId || userId <= 0) {
      return res.status(400).json({ error: "Invalid user_id" });
    }

    // validate client exists
    const c = await pool.query(
      `SELECT id FROM public.users WHERE id=$1 AND UPPER(role)='CLIENT'`,
      [userId]
    );
    if (c.rowCount === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    // if case_id provided, ensure case belongs to this client
    if (case_id) {
      const cc = await pool.query(
        `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
        [case_id, userId]
      );
      if (cc.rowCount === 0) {
        return res.status(400).json({ error: "Invalid case_id for this client" });
      }
    }

    // optional advocate_id check (only if provided)
    if (advocate_id) {
      const a = await pool.query(`SELECT id FROM public.users WHERE id=$1`, [advocate_id]);
      if (a.rowCount === 0) {
        return res.status(400).json({ error: "Invalid advocate_id" });
      }
    }

    // optional file upload (if admin attaches anything)
    const voucher_file_url = req.file?.filename ? `/uploads/${req.file.filename}` : null;

    const r = await pool.query(
      `
      INSERT INTO public.client_billing
        (
          user_id,
          title,
          description,
          amount,
          status,
          due_date,
          voucher_file_url,

          bank_name,
          bank_account_title,
          bank_account_number,
          bank_branch,

          case_id,
          advocate_id,
          is_installment,
          sequence_no,

          voucher_version,
          created_by_admin_id,
          issued_by_admin_id,
          issued_at
        )
      VALUES
        ($1,$2,$3,$4,'ISSUED_PENDING_PAYMENT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'INSSAFDAR_V1',$15,$15,NOW())
      RETURNING *
      `,
      [
        userId,
        title,
        description || null,
        amountNum,
        due_date,
        voucher_file_url,

        bank_name,
        bank_account_title,
        bank_account_number,
        bank_branch,

        case_id,
        advocate_id,
        Boolean(req.body?.is_installment),
        Math.max(1, Number(req.body?.sequence_no || 1)),

        adminId,
      ]
    );

    if (case_id) {
      await recomputeCasePaymentRollup(pool, case_id);
      await logCasePaymentEvent(pool, {
        caseId: case_id,
        billingId: r.rows[0]?.id,
        eventType: "VOUCHER_CREATED",
        actorUserId: adminId,
        actorRole: req.user?.role || "ADMIN",
        metadata: {
          amount: r.rows[0]?.amount,
          status: r.rows[0]?.status,
          is_installment: r.rows[0]?.is_installment,
          sequence_no: r.rows[0]?.sequence_no,
        },
      });
    }

    // ✅ Generate PDF immediately so the voucher is viewable/downloadable by
    // the client right away (previously only "Issue/Send" produced the PDF).
    const billingId = r.rows[0]?.id;
    if (billingId) {
      try {
        const gen = await generateVoucherPdfForBillingId(billingId);
        if (gen?.publicUrl) {
          await pool.query(`UPDATE public.client_billing SET voucher_pdf_url=$2, updated_at=NOW() WHERE id=$1`, [billingId, gen.publicUrl]);
          r.rows[0].voucher_pdf_url = gen.publicUrl;
        }
      } catch (pdfErr) {
        // PDF generation must not fail voucher creation; log and continue.
        console.error("createVoucher: PDF generation failed (voucher still created):", pdfErr);
      }
    }

    return res.json({ ok: true, billing: r.rows[0] });
  } catch (e) {
    console.error("createVoucher error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/admin/client-access/billing/vouchers/:billingId/send
 * Generates PDF from DB data + stores voucher_pdf_url + notifies client
 */
export async function sendVoucherToClient(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const billingId = toInt(req.params.billingId);
    if (!billingId) return res.status(400).json({ error: "Invalid billingId" });

    const r = await pool.query(
      `
      SELECT id, user_id, case_id, title, amount, status
      FROM public.client_billing
      WHERE id=$1
      `,
      [billingId]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: "Voucher not found" });

    const status = String(r.rows[0].status || "").toUpperCase();
    if (status === "VERIFIED") return res.status(409).json({ error: "Already verified" });

    // ✅ generate PDF now (fresh)
    let pdfUrl = null;
    try {
      const gen = await generateVoucherPdfForBillingId(billingId);
      pdfUrl = gen.publicUrl;

      await pool.query(
        `
        UPDATE public.client_billing
        SET voucher_pdf_url=$2, status='ISSUED_PENDING_PAYMENT', issued_by_admin_id=$3, issued_at=COALESCE(issued_at, NOW()), updated_at=NOW()
        WHERE id=$1
        `,
        [billingId, pdfUrl, adminId]
      );
    } catch (pdfErr) {
      console.error("Voucher PDF generation failed:", pdfErr);
      return res.status(500).json({ error: "Failed to generate voucher PDF" });
    }

    // ✅ notify client
    await notifyClient({
      userId: r.rows[0].user_id,
      title: `Fee Voucher Sent: ${r.rows[0].title}`,
      message:
        `Amount: ${r.rows[0].amount}\n` +
        `Voucher PDF: ${pdfUrl}\n` +
        `Please download the voucher and upload payment proof from your dashboard.`,
      type: "BILLING",
      priority: "HIGH",
    });

    const billingRow = r.rows[0];
    if (billingRow?.case_id) {
      await recomputeCasePaymentRollup(pool, billingRow.case_id);
      await logCasePaymentEvent(pool, {
        caseId: billingRow.case_id,
        billingId,
        eventType: "VOUCHER_ISSUED",
        actorUserId: adminId,
        actorRole: req.user?.role || "ADMIN",
        metadata: { voucherPdfUrl: pdfUrl },
      });
    }

    return res.json({ ok: true, voucher_pdf_url: pdfUrl });
  } catch (e) {
    console.error("sendVoucherToClient error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/client-access/billing/client/:userId
 * List all billing items for a client
 */
export async function listClientBilling(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const userId = toInt(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Invalid userId" });

    const r = await pool.query(
      `
      SELECT *
      FROM public.client_billing
      WHERE user_id=$1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.json({ billing: r.rows });
  } catch (e) {
    console.error("listClientBilling error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/client-access/billing/proofs/pending
 */
export async function listPendingProofs(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const r = await pool.query(
      `
      SELECT
        p.id AS proof_id,
        p.user_id AS client_user_id,
        p.proof_file_url,
        p.note,
        p.created_at AS uploaded_at,
        b.id AS billing_id,
        b.case_id,
        b.status AS billing_status,
        b.title,
        b.amount,
        b.voucher_pdf_url,
        u.email AS client_email
      FROM public.client_payment_proofs p
      JOIN public.client_billing b ON b.id=p.billing_id
      JOIN public.users u ON u.id=b.user_id
      WHERE p.status='UPLOADED'
      ORDER BY p.created_at DESC
      `
    );

    return res.json({ proofs: r.rows });
  } catch (e) {
    console.error("listPendingProofs error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * PATCH /api/admin/client-access/billing/proofs/:proofId/verify
 */
export async function verifyProof(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  const client = await pool.connect();
  try {
    const proofId = toInt(req.params.proofId);
    if (!proofId) return res.status(400).json({ error: "Invalid proofId" });

    await client.query("BEGIN");

    const p = await client.query(
      `
      SELECT p.user_id, p.billing_id, p.status, b.title, b.case_id
      FROM public.client_payment_proofs p
      JOIN public.client_billing b ON b.id=p.billing_id
      WHERE p.id=$1
      FOR UPDATE
      `,
      [proofId]
    );

    if (p.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Proof not found" });
    }

    if (p.rows[0].status !== "UPLOADED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Already processed" });
    }

    await client.query(
      `
      UPDATE public.client_payment_proofs
      SET status='VERIFIED', verified_by_admin_id=$2, verified_at=NOW()
      WHERE id=$1
      `,
      [proofId, adminId]
    );

    await client.query(
      `
        UPDATE public.client_billing
        SET status='PAID_VERIFIED',
            verified_by_admin_id=$2,
            verified_at=NOW(),
            rejection_note=NULL,
            updated_at=NOW()
        WHERE id=$1
      `,
      [p.rows[0].billing_id, adminId]
    );

    if (p.rows[0].case_id) {
      await recomputeCasePaymentRollup(client, p.rows[0].case_id);
      await logCasePaymentEvent(client, {
        caseId: p.rows[0].case_id,
        billingId: p.rows[0].billing_id,
        eventType: "PAYMENT_VERIFIED",
        actorUserId: adminId,
        actorRole: req.user?.role || "ADMIN",
      });
    }

    await client.query("COMMIT");

    await notifyClient({
      userId: p.rows[0].user_id,
      title: "Payment Verified",
      message: `Your payment for "${p.rows[0].title}" has been verified.`,
      type: "BILLING",
      priority: "HIGH",
    });

    return res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("verifyProof error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/admin/client-access/billing/proofs/:proofId/reject
 */
export async function rejectProof(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  const client = await pool.connect();
  try {
    const proofId = toInt(req.params.proofId);
    if (!proofId) return res.status(400).json({ error: "Invalid proofId" });

    const reason = String(req.body?.reason || "Payment proof rejected").trim();

    await client.query("BEGIN");

    const p = await client.query(
      `
      SELECT p.user_id, p.billing_id, p.status, b.title, b.case_id
      FROM public.client_payment_proofs p
      JOIN public.client_billing b ON b.id=p.billing_id
      WHERE p.id=$1
      FOR UPDATE
      `,
      [proofId]
    );

    if (p.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Proof not found" });
    }

    if (p.rows[0].status !== "UPLOADED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Already processed" });
    }

    await client.query(
      `
      UPDATE public.client_payment_proofs
      SET status='REJECTED', verified_by_admin_id=$2, verified_at=NOW()
      WHERE id=$1
      `,
      [proofId, adminId]
    );

    await client.query(
      `
        UPDATE public.client_billing
        SET status='PAYMENT_REJECTED',
            rejection_note=$2,
            updated_at=NOW()
        WHERE id=$1
      `,
      [p.rows[0].billing_id, reason]
    );

    if (p.rows[0].case_id) {
      await recomputeCasePaymentRollup(client, p.rows[0].case_id);
      await logCasePaymentEvent(client, {
        caseId: p.rows[0].case_id,
        billingId: p.rows[0].billing_id,
        eventType: "PAYMENT_REJECTED",
        actorUserId: adminId,
        actorRole: req.user?.role || "ADMIN",
        metadata: { reason },
      });
    }

    await client.query("COMMIT");

    await notifyClient({
      userId: p.rows[0].user_id,
      title: "Payment Rejected",
      message: `Your payment proof for "${p.rows[0].title}" was rejected.\nReason: ${reason}`,
      type: "BILLING",
      priority: "HIGH",
    });

    return res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("rejectProof error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * GET /api/admin/client-access/billing/cases/options
 * Returns case-context options for voucher creation (case-first UX)
 */
export async function listVoucherCaseOptions(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const r = await pool.query(
      `
      SELECT
        c.id AS case_id,
        c.user_id AS client_user_id,
        c.assigned_advocate_id,
        c.status,
        c.title AS case_title,
        c.payment_required_total,
        c.payment_verified_total,
        c.payment_status,
        u.name AS client_name,
        u.email AS client_email,
        a.name AS advocate_name,
        a.email AS advocate_email,
        c.updated_at
      FROM public.client_cases c
      JOIN public.users u ON u.id = c.user_id
      LEFT JOIN public.users a ON a.id = c.assigned_advocate_id
      WHERE UPPER(c.status) = 'CASE_ACTIVE'
      ORDER BY c.updated_at DESC
      LIMIT 300
      `
    );

    return res.json({ cases: r.rows });
  } catch (e) {
    console.error("listVoucherCaseOptions error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/admin/client-access/billing/cases/:caseId/vouchers
 * Creates voucher in case-context (case_id + client_id inferred server-side)
 */
export async function createVoucherForCase(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  const caseId = toInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

  const dbClient = await pool.connect();
  try {
    const c = await dbClient.query(
      `
      SELECT id, user_id, assigned_advocate_id, status
      FROM public.client_cases
      WHERE id = $1
      FOR UPDATE
      `,
      [caseId]
    );
    if (!c.rowCount) return res.status(404).json({ error: "Case not found" });

    const caseRow = c.rows[0];
    if (String(caseRow.status || "").toUpperCase() !== "CASE_ACTIVE") {
      return res.status(409).json({ error: `Voucher creation allowed only for CASE_ACTIVE cases. Current: ${caseRow.status}` });
    }

    const title = String(req.body?.title || "Case Voucher").trim();
    const description = String(req.body?.description || "").trim();
    const amountNum = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    let due_date = null;
    if (req.body?.due_date) {
      const d = new Date(req.body.due_date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid due_date" });
      }
      due_date = d;
    }

    const bank_account_number = req.body?.bank_account_number
      ? String(req.body.bank_account_number).trim()
      : null;
    const bank_branch = req.body?.bank_branch
      ? String(req.body.bank_branch).trim()
      : null;
    const bank_name = req.body?.bank_name ? String(req.body.bank_name).trim() : null;
    const bank_account_title = req.body?.bank_account_title
      ? String(req.body.bank_account_title).trim()
      : null;

    const voucher_file_url = req.file?.filename ? `/uploads/${req.file.filename}` : null;

    const ins = await dbClient.query(
      `
      INSERT INTO public.client_billing
        (
          user_id,
          title,
          description,
          amount,
          status,
          due_date,
          voucher_file_url,
          bank_name,
          bank_account_title,
          bank_account_number,
          bank_branch,
          case_id,
          advocate_id,
          is_installment,
          sequence_no,
          voucher_version,
          created_by_admin_id,
          issued_by_admin_id,
          issued_at
        )
      VALUES
        ($1,$2,$3,$4,'ISSUED_PENDING_PAYMENT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'INSSAFDAR_V1',$15,$15,NOW())
      RETURNING *
      `,
      [
        Number(caseRow.user_id),
        title,
        description || null,
        amountNum,
        due_date,
        voucher_file_url,
        bank_name,
        bank_account_title,
        bank_account_number,
        bank_branch,
        caseId,
        caseRow.assigned_advocate_id ? Number(caseRow.assigned_advocate_id) : null,
        Boolean(req.body?.is_installment),
        Math.max(1, Number(req.body?.sequence_no || 1)),
        adminId,
      ]
    );

    await recomputeCasePaymentRollup(dbClient, caseId);
    await logCasePaymentEvent(dbClient, {
      caseId,
      billingId: ins.rows[0]?.id,
      eventType: "VOUCHER_CREATED",
      actorUserId: adminId,
      actorRole: req.user?.role || "ADMIN",
      metadata: {
        amount: ins.rows[0]?.amount,
        status: ins.rows[0]?.status,
        is_installment: ins.rows[0]?.is_installment,
        sequence_no: ins.rows[0]?.sequence_no,
      },
    });

    // ✅ Generate PDF immediately so the voucher is viewable/downloadable by
    // the client right away (previously only "Issue/Send" produced the PDF).
    const billingId = ins.rows[0]?.id;
    if (billingId) {
      try {
        const gen = await generateVoucherPdfForBillingId(billingId);
        if (gen?.publicUrl) {
          await dbClient.query(
            `UPDATE public.client_billing SET voucher_pdf_url=$2, updated_at=NOW() WHERE id=$1`,
            [billingId, gen.publicUrl]
          );
          ins.rows[0].voucher_pdf_url = gen.publicUrl;
        }
      } catch (pdfErr) {
        // PDF generation must not fail voucher creation; log and continue.
        console.error("createVoucherForCase: PDF generation failed (voucher still created):", pdfErr);
      }
    }

    return res.json({ ok: true, billing: ins.rows[0] });
  } catch (e) {
    console.error("createVoucherForCase error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    dbClient.release();
  }
}

/**
 * POST /api/admin/client-access/billing/cases/:caseId/manual-payment-status
 * Body: { status: 'UNPAID'|'PARTIALLY_PAID'|'FULLY_PAID', note: string }
 */
export async function setCasePaymentManualStatus(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  const client = await pool.connect();
  try {
    const caseId = toInt(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const status = String(req.body?.status || "").trim().toUpperCase();
    const note = String(req.body?.note || "").trim();
    const allowed = ["UNPAID", "PARTIALLY_PAID", "FULLY_PAID", "CLEAR_OVERRIDE"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    if (status !== "CLEAR_OVERRIDE" && !note) {
      return res.status(400).json({ error: "note is required for manual override" });
    }

    await client.query("BEGIN");

    const exists = await client.query(`SELECT id FROM public.client_cases WHERE id = $1 FOR UPDATE`, [caseId]);
    if (!exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found" });
    }

    await recomputeCasePaymentRollup(client, caseId);

    if (status === "CLEAR_OVERRIDE") {
      await client.query(
        `
          UPDATE public.client_cases
          SET payment_manual_override_status = NULL,
              payment_manual_override_note = NULL,
              payment_manual_override_by = NULL,
              payment_manual_override_at = NULL,
              payment_status = payment_status_computed,
              updated_at = NOW()
          WHERE id = $1
        `,
        [caseId]
      );
    } else {
      await client.query(
        `
          UPDATE public.client_cases
          SET payment_manual_override_status = $2,
              payment_manual_override_note = $3,
              payment_manual_override_by = $4,
              payment_manual_override_at = NOW(),
              payment_status = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [caseId, status, note, adminId]
      );
    }

    await logCasePaymentEvent(client, {
      caseId,
      eventType: status === "CLEAR_OVERRIDE" ? "PAYMENT_OVERRIDE_CLEARED" : "PAYMENT_MANUAL_OVERRIDE_SET",
      actorUserId: adminId,
      actorRole: req.user?.role || "ADMIN",
      metadata: { status, note: note || null },
    });

    const out = await client.query(
      `
        SELECT id, payment_required_total, payment_verified_total, payment_status_computed, payment_status,
               payment_manual_override_status, payment_manual_override_note, payment_manual_override_at
        FROM public.client_cases
        WHERE id = $1
      `,
      [caseId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, payment: out.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("setCasePaymentManualStatus error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

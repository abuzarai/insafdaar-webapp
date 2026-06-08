// import pool from "../../../db.js";

// /**
//  * GET /api/client/dashboard/billing/invoices
//  * Returns all invoices for client (by user_id via client_cases)
//  */
// export async function getMyInvoices(req, res) {
//   try {
//     const userId = req.user.id;

//     const r = await pool.query(
//       `
//       SELECT 
//         i.id,
//         i.case_id,
//         c.title as case_title,
//         i.amount,
//         i.status,
//         i.voucher_id,
//         i.voucher_url,
//         i.due_date,
//         i.payment_proof_url,
//         i.payment_proof_status,
//         i.created_at,
//         i.updated_at
//       FROM public.case_invoices i
//       JOIN public.client_cases c ON c.id = i.case_id
//       WHERE c.user_id = $1
//       ORDER BY i.created_at DESC
//       `,
//       [userId]
//     );

//     return res.json({ invoices: r.rows });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// }

// /**
//  * GET /api/client/dashboard/billing/invoices/:invoiceId
//  */
// export async function getInvoiceById(req, res) {
//   try {
//     const userId = req.user.id;
//     const invoiceId = Number(req.params.invoiceId);

//     const r = await pool.query(
//       `
//       SELECT 
//         i.*,
//         c.title as case_title
//       FROM public.case_invoices i
//       JOIN public.client_cases c ON c.id = i.case_id
//       WHERE i.id = $1 AND c.user_id = $2
//       `,
//       [invoiceId, userId]
//     );

//     if (r.rows.length === 0) return res.status(404).json({ error: "Invoice not found" });

//     return res.json({ invoice: r.rows[0] });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// }

// /**
//  * POST /api/client/dashboard/billing/invoices/:invoiceId/proof (multipart)
//  * form-data: proof(file)
//  */
// export async function uploadPaymentProof(req, res) {
//   try {
//     const userId = req.user.id;
//     const invoiceId = Number(req.params.invoiceId);

//     if (!req.file) return res.status(400).json({ error: "proof file is required" });

//     // verify ownership via case
//     const inv = await pool.query(
//       `
//       SELECT i.id, i.case_id
//       FROM public.case_invoices i
//       JOIN public.client_cases c ON c.id = i.case_id
//       WHERE i.id = $1 AND c.user_id = $2
//       `,
//       [invoiceId, userId]
//     );

//     if (inv.rows.length === 0) return res.status(404).json({ error: "Invoice not found" });

//     const proofUrl = `/uploads/billing-proofs/${req.file.filename}`;

//     await pool.query(
//       `
//       UPDATE public.case_invoices
//       SET payment_proof_url=$1,
//           payment_proof_status='UPLOADED',
//           updated_at=NOW()
//       WHERE id=$2
//       `,
//       [proofUrl, invoiceId]
//     );

//     return res.json({
//       message: "Payment proof uploaded",
//       paymentProofUrl: proofUrl,
//       paymentProofStatus: "UPLOADED",
//     });
//   } catch (err) {
//     return res.status(400).json({ error: err.message });
//   }
// }

import pool from "../../../db.js";

/**
 * GET /api/client/dashboard/billing/invoices
 * Returns all invoices for logged-in client
 */
export async function getMyInvoices(req, res) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `
      SELECT 
        i.id,
        i.case_id,
        c.title AS case_title,
        i.amount,
        i.status,
        i.voucher_id,
        i.voucher_url,
        i.due_date,
        i.payment_proof_url,
        i.payment_proof_status,
        i.created_at,
        i.updated_at
      FROM public.case_invoices i
      JOIN public.client_cases c ON c.id = i.case_id
      WHERE c.user_id = $1
      ORDER BY i.created_at DESC
      `,
      [userId]
    );

    return res.json({ invoices: r.rows });
  } catch (err) {
    console.error("getMyInvoices error:", err);
    return res.status(500).json({ error: "Failed to load invoices" });
  } 
}

/**
 * GET /api/client/dashboard/billing/invoices/:invoiceId
 */
export async function getInvoiceById(req, res) {
  try {
    const userId = req.user.id;
    const invoiceId = Number(req.params.invoiceId);

    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }

    const r = await pool.query(
      `
      SELECT 
        i.*,
        c.title AS case_title
      FROM public.case_invoices i
      JOIN public.client_cases c ON c.id = i.case_id
      WHERE i.id = $1 AND c.user_id = $2
      `,
      [invoiceId, userId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    return res.json({ invoice: r.rows[0] });
  } catch (err) {
    console.error("getInvoiceById error:", err);
    return res.status(500).json({ error: "Failed to load invoice" });
  }
}

/**
 * POST /api/client/dashboard/billing/invoices/:invoiceId/proof
 * Client uploads payment proof for invoice
 */
export async function uploadPaymentProof(req, res) {
  try {
    const userId = req.user.id;
    const invoiceId = Number(req.params.invoiceId);

    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }

    if (!req.file?.filename) {
      return res.status(400).json({ error: "Payment proof file is required" });
    }

    // 🔒 Verify ownership + status
    const inv = await pool.query(
      `
      SELECT 
        i.id,
        i.payment_proof_status
      FROM public.case_invoices i
      JOIN public.client_cases c ON c.id = i.case_id
      WHERE i.id = $1 AND c.user_id = $2
      `,
      [invoiceId, userId]
    );

    if (inv.rowCount === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const currentStatus = String(inv.rows[0].payment_proof_status || "").toUpperCase();

    // 🔒 LOCK if already verified
    if (currentStatus === "VERIFIED") {
      return res.status(400).json({
        error: "Payment already verified. Upload is locked.",
      });
    }

    const proofUrl = `/uploads/billing-proofs/${req.file.filename}`;

    await pool.query(
      `
      UPDATE public.case_invoices
      SET payment_proof_url = $1,
          payment_proof_status = 'UPLOADED',
          updated_at = NOW()
      WHERE id = $2
      `,
      [proofUrl, invoiceId]
    );

    return res.json({
      ok: true,
      message: "Payment proof uploaded successfully",
      paymentProofUrl: proofUrl,
      paymentProofStatus: "UPLOADED",
    });
  } catch (err) {
    console.error("uploadPaymentProof error:", err);
    return res.status(500).json({ error: "Failed to upload payment proof" });
  }
}

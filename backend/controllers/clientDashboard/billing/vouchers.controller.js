// import pool from "../../../db.js";
// import { sendNotificationEmail } from "../../../utils/mailer.js";

// /**
//  * GET /api/client/dashboard/billing/vouchers
//  * List all vouchers for logged-in client
//  */
// export async function listMyVouchers(req, res) {
//   try {
//     const userId = req.user.id;

//     const r = await pool.query(
//       `
//       SELECT
//         id,
//         title,
//         description,
//         amount,
//         status,
//         due_date,
//         voucher_file_url,
//         created_at
//       FROM public.client_billing
//       WHERE user_id = $1
//       ORDER BY created_at DESC
//       `,
//       [userId]
//     );

//     return res.json({ vouchers: r.rows });
//   } catch (e) {
//     console.error("listMyVouchers error:", e);
//     return res.status(500).json({ error: "Failed to load vouchers" });
//   }
// }

// /**
//  * GET /api/client/dashboard/billing/vouchers/:billingId
//  * View a single voucher + latest payment proof (if any)
//  */
// export async function getMyVoucherById(req, res) {
//   try {
//     const userId = req.user.id;
//     const billingId = Number(req.params.billingId);

//     if (!Number.isFinite(billingId) || billingId <= 0) {
//       return res.status(400).json({ error: "Invalid voucher id" });
//     }

//     const r = await pool.query(
//       `
//       SELECT
//         b.*,
//         p.id AS proof_id,
//         p.proof_file_url,
//         p.status AS proof_status,
//         p.created_at AS proof_uploaded_at,
//         p.verified_at
//       FROM public.client_billing b
//       LEFT JOIN public.client_payment_proofs p
//         ON p.billing_id = b.id
//       WHERE b.id = $1 AND b.user_id = $2
//       ORDER BY p.created_at DESC
//       LIMIT 1
//       `,
//       [billingId, userId]
//     );

//     if (r.rowCount === 0) {
//       return res.status(404).json({ error: "Voucher not found" });
//     }

//     return res.json({ voucher: r.rows[0] });
//   } catch (e) {
//     console.error("getMyVoucherById error:", e);
//     return res.status(500).json({ error: "Failed to load voucher" });
//   }
// }

// /**
//  * POST /api/client/dashboard/billing/vouchers/:billingId/proof
//  * Client uploads payment proof for voucher
//  */
// export async function uploadVoucherProof(req, res) {
//   try {
//     const userId = req.user.id;
//     const billingId = Number(req.params.billingId);

//     if (!Number.isFinite(billingId) || billingId <= 0) {
//       return res.status(400).json({ error: "Invalid voucher id" });
//     }

//     if (!req.file?.filename) {
//       return res.status(400).json({ error: "Payment proof file is required" });
//     }

//     // validate voucher ownership + status
//     const b = await pool.query(
//       `
//       SELECT id, status, title, amount
//       FROM public.client_billing
//       WHERE id = $1 AND user_id = $2
//       `,
//       [billingId, userId]
//     );

//     if (b.rowCount === 0) {
//       return res.status(404).json({ error: "Voucher not found" });
//     }

//     const status = String(b.rows[0].status || "").toUpperCase();

//     // allow upload / re-upload
//     const allowedStatuses = ["SENT", "REJECTED", "PROOF_UPLOADED"];
//     if (!allowedStatuses.includes(status)) {
//       return res.status(400).json({
//         error: `Cannot upload proof when voucher status is ${status}`,
//       });
//     }

//     // multer saves in uploads/billing-proofs, so URL should match that
//     const fileUrl = `/uploads/billing-proofs/${req.file.filename}`;
//     const note = req.body?.note ? String(req.body.note).trim() : null;

//     // insert proof
//     await pool.query(
//       `
//       INSERT INTO public.client_payment_proofs
//         (billing_id, user_id, proof_file_url, note, status)
//       VALUES ($1, $2, $3, $4, 'UPLOADED')
//       `,
//       [billingId, userId, fileUrl, note]
//     );

//     // update voucher status
//     await pool.query(
//       `
//       UPDATE public.client_billing
//       SET status='PROOF_UPLOADED', updated_at=NOW()
//       WHERE id=$1
//       `,
//       [billingId]
//     );

//     // ✅ EMAIL ADMIN (fallback to your email)
//     const adminEmail = process.env.ADMIN_EMAIL;

//     try {
//       await sendNotificationEmail({
//         to: adminEmail,
//         subject: "New payment proof uploaded",
//         title: "New Payment Proof Uploaded",
//         message: `
//           <p>A client uploaded payment proof.</p>
//           <ul>
//             <li><b>Voucher ID:</b> ${billingId}</li>
//             <li><b>Title:</b> ${b.rows[0].title}</li>
//             <li><b>Amount:</b> ${b.rows[0].amount}</li>
//             <li><b>Client User ID:</b> ${userId}</li>
//             <li><b>Proof URL:</b> ${fileUrl}</li>
//           </ul>
//           ${note ? `<p><b>Note:</b> ${note}</p>` : ""}
//         `,
//       });
//     } catch (mailErr) {
//       console.error("Admin email failed:", mailErr);
//       // do NOT fail upload if email fails
//     }

//     return res.json({
//       ok: true,
//       message: "Payment proof uploaded successfully",
//       proof_file_url: fileUrl,
//       status: "PROOF_UPLOADED",
//     });
//   } catch (e) {
//     console.error("uploadVoucherProof error:", e);
//     return res.status(500).json({ error: "Failed to upload payment proof" });
//   }
// }


import pool from "../../../db.js";
import { sendNotificationEmail } from "../../../utils/mailer.js";
import { notifyAllAdmins } from "../../../utils/notify.js"; // ✅ ADDED
import { logCasePaymentEvent, recomputeCasePaymentRollup } from "../../../utils/casePayments.js";

/**
 * GET /api/client/dashboard/billing/vouchers
 * List all vouchers for logged-in client
 */
export async function listMyVouchers(req, res) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `
      SELECT
        id,
        title,
        description,
        amount,
        status,
        due_date,
        voucher_file_url,
        created_at
      FROM public.client_billing
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.json({ vouchers: r.rows });
  } catch (e) {
    console.error("listMyVouchers error:", e);
    return res.status(500).json({ error: "Failed to load vouchers" });
  }
}

/**
 * GET /api/client/dashboard/billing/vouchers/:billingId
 * View a single voucher + latest payment proof (if any)
 */
export async function getMyVoucherById(req, res) {
  try {
    const userId = req.user.id;
    const billingId = Number(req.params.billingId);

    if (!Number.isFinite(billingId) || billingId <= 0) {
      return res.status(400).json({ error: "Invalid voucher id" });
    }

    const r = await pool.query(
      `
      SELECT
        b.*,
        p.id AS proof_id,
        p.proof_file_url,
        p.status AS proof_status,
        p.created_at AS proof_uploaded_at,
        p.verified_at
      FROM public.client_billing b
      LEFT JOIN public.client_payment_proofs p
        ON p.billing_id = b.id
      WHERE b.id = $1 AND b.user_id = $2
      ORDER BY p.created_at DESC
      LIMIT 1
      `,
      [billingId, userId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Voucher not found" });
    }

    return res.json({ voucher: r.rows[0] });
  } catch (e) {
    console.error("getMyVoucherById error:", e);
    return res.status(500).json({ error: "Failed to load voucher" });
  }
}

/**
 * POST /api/client/dashboard/billing/vouchers/:billingId/proof
 * Client uploads payment proof for voucher
 */
export async function uploadVoucherProof(req, res) {
  try {
    const userId = req.user.id;
    const billingId = Number(req.params.billingId);

    if (!Number.isFinite(billingId) || billingId <= 0) {
      return res.status(400).json({ error: "Invalid voucher id" });
    }

    if (!req.file?.filename) {
      return res.status(400).json({ error: "Payment proof file is required" });
    }

    // validate voucher ownership + status
    const b = await pool.query(
      `
      SELECT id, status, title, amount
      FROM public.client_billing
      WHERE id = $1 AND user_id = $2
      `,
      [billingId, userId]
    );

    if (b.rowCount === 0) {
      return res.status(404).json({ error: "Voucher not found" });
    }

    const status = String(b.rows[0].status || "").toUpperCase();

    // allow upload / re-upload
    const allowedStatuses = ["ISSUED_PENDING_PAYMENT", "PAYMENT_REJECTED", "PAYMENT_PROOF_UPLOADED", "SENT", "REJECTED", "PROOF_UPLOADED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `Cannot upload proof when voucher status is ${status}`,
      });
    }

    // multer saves in uploads/billing-proofs, so URL should match that
    const fileUrl = `/uploads/billing-proofs/${req.file.filename}`;
    const note = req.body?.note ? String(req.body.note).trim() : null;

    // insert proof
    await pool.query(
      `
      INSERT INTO public.client_payment_proofs
        (billing_id, user_id, proof_file_url, note, status, mime_type, file_size)
      VALUES ($1, $2, $3, $4, 'UPLOADED', $5, $6)
      `,
      [billingId, userId, fileUrl, note, req.file.mimetype || null, Number(req.file.size || 0)]
    );

    // update voucher status
    await pool.query(
      `
      UPDATE public.client_billing
      SET status='PAYMENT_PROOF_UPLOADED', updated_at=NOW()
      WHERE id=$1
      `,
      [billingId]
    );

    const caseInfo = await pool.query(`SELECT case_id FROM public.client_billing WHERE id = $1`, [billingId]);
    const caseId = Number(caseInfo.rows[0]?.case_id || 0) || null;
    if (caseId) {
      await recomputeCasePaymentRollup(pool, caseId);
      await logCasePaymentEvent(pool, {
        caseId,
        billingId,
        eventType: "PAYMENT_PROOF_UPLOADED",
        actorUserId: userId,
        actorRole: req.user?.role || "CLIENT",
      });
    }

    // ✅ ADDED: ADMIN DASHBOARD NOTIFICATION (DB)
    try {
      await notifyAllAdmins({
        title: "New payment proof uploaded",
        message: `Voucher ID: ${billingId}, Title: ${b.rows[0].title}, Amount: ${b.rows[0].amount}, Client User ID: ${userId}, Proof URL: ${fileUrl}${
          note ? `, Note: ${note}` : ""
        }`,
        type: "BILLING",
      });
    } catch (notifyErr) {
      console.error("Admin dashboard notification failed:", notifyErr);
      // do NOT fail upload if notification fails
    }

    // ✅ EMAIL ADMIN
    const adminEmail = process.env.ADMIN_EMAIL;

    try {
      await sendNotificationEmail({
        to: adminEmail,
        subject: "New payment proof uploaded",
        title: "New Payment Proof Uploaded",
        message: `
          <p>A client uploaded payment proof.</p>
          <ul>
            <li><b>Voucher ID:</b> ${billingId}</li>
            <li><b>Title:</b> ${b.rows[0].title}</li>
            <li><b>Amount:</b> ${b.rows[0].amount}</li>
            <li><b>Client User ID:</b> ${userId}</li>
            <li><b>Proof URL:</b> ${fileUrl}</li>
          </ul>
          ${note ? `<p><b>Note:</b> ${note}</p>` : ""}
        `,
      });
    } catch (mailErr) {
      console.error("Admin email failed:", mailErr);
      // do NOT fail upload if email fails
    }

    return res.json({
      ok: true,
      message: "Payment proof uploaded successfully",
      proof_file_url: fileUrl,
      status: "PAYMENT_PROOF_UPLOADED",
    });
  } catch (e) {
    console.error("uploadVoucherProof error:", e);
    return res.status(500).json({ error: "Failed to upload payment proof" });
  }
}

import pool from "../../db.js";
import { notifyClient, notifyAllAdmins } from "../../utils/notify.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function listMyBilling(req, res) {
  try {
    const userId = toInt(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const r = await pool.query(
      `SELECT * FROM public.client_billing WHERE user_id=$1 ORDER BY created_at DESC`,
      [userId]
    );

    return res.json({ billing: r.rows });
  } catch (e) {
    console.error("listMyBilling error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function uploadPaymentProof(req, res) {
  const client = await pool.connect();
  try {
    const userId = toInt(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const billingId = toInt(req.params.billingId);
    if (!billingId) return res.status(400).json({ error: "Invalid billingId" });

    if (!req.file?.filename) return res.status(400).json({ error: "Proof file is required" });

    const fileUrl = `/uploads/${req.file.filename}`;
    const note = req.body?.note ? String(req.body.note).trim() : null;

    await client.query("BEGIN");

    // Lock billing row (prevents races)
    const bill = await client.query(
      `SELECT id, user_id, title, status FROM public.client_billing WHERE id=$1 FOR UPDATE`,
      [billingId]
    );
    if (bill.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Billing item not found" });
    }

    const row = bill.rows[0];

    if (toInt(row.user_id) !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Not your billing item" });
    }

    // Only allow upload after voucher is sent or proof already uploaded
    const allowedStatuses = ["SENT", "PROOF_UPLOADED"];
    if (!allowedStatuses.includes(String(row.status || "").toUpperCase())) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `You cannot upload proof right now. Current status: ${row.status}`,
      });
    }

    // ✅ If an old proof is still UPLOADED, mark it REJECTED (so there’s only 1 pending proof)
    await client.query(
      `
      UPDATE public.client_payment_proofs
      SET status='REJECTED'
      WHERE billing_id=$1 AND user_id=$2 AND status='UPLOADED'
      `,
      [billingId, userId]
    );

    // Insert new proof
    await client.query(
      `
      INSERT INTO public.client_payment_proofs
        (billing_id, user_id, proof_file_url, note, status)
      VALUES ($1,$2,$3,$4,'UPLOADED')
      `,
      [billingId, userId, fileUrl, note]
    );

    // Update billing status
    await client.query(
      `UPDATE public.client_billing SET status='PROOF_UPLOADED', updated_at=NOW() WHERE id=$1`,
      [billingId]
    );

    await client.query("COMMIT");

    // Notify after commit
    await notifyClient({
      userId,
      title: "Payment Proof Uploaded",
      message: "Your payment proof has been uploaded successfully. Admin will verify it soon.",
      type: "BILLING",
      priority: "NORMAL",
    });

    await notifyAllAdmins({
      title: "Payment Proof Uploaded",
      message: `Client uploaded payment proof for billing #${billingId}. Please verify it.`,
      type: "BILLING",
    });

    return res.json({ ok: true, proof_file_url: fileUrl });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("uploadPaymentProof error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

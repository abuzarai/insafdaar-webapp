import pool from "../../../../db.js";


/**
 * GET /api/admin/client-access/dashboard/clients/:userId/cases
 */
export async function adminListClientCases(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Invalid userId" });

    const { q = "", status = "All", limit = "50", offset = "0" } = req.query || {};
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    const where = [`c.user_id = $1`];
    const values = [userId];
    let idx = values.length;

    if (status !== "All") {
      idx++;
      where.push(`c.status = $${idx}`);
      values.push(String(status));
    }

    if (String(q).trim()) {
      idx++;
      where.push(`(
        CAST(c.id AS TEXT) ILIKE $${idx}
        OR COALESCE(c.title,'') ILIKE $${idx}
        OR COALESCE(c.description,'') ILIKE $${idx}
      )`);
      values.push(`%${String(q).trim()}%`);
    }

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.client_cases c
       WHERE ${where.join(" AND ")}`,
      values
    );

    values.push(lim, off);

    const rowsRes = await pool.query(
      `
      SELECT
        c.id, c.title, c.status, c.source, c.language, c.created_at, c.updated_at,

        cu.name  AS client_name,
        cu.email AS client_email,

        a.id     AS advocate_id,
        a.name   AS advocate_name,
        a.email  AS advocate_email,

        COALESCE((
          SELECT COUNT(*)::int
          FROM public.client_notifications n
          WHERE n.user_id = c.user_id
            AND n.case_id = c.id
            AND n.is_read = false
        ), 0) AS alerts_count,

        inv.id         AS invoice_id,
        inv.amount     AS invoice_amount,
        inv.status     AS invoice_status,
        inv.voucher_id AS voucher_id,
        inv.due_date   AS invoice_due_date

      FROM public.client_cases c
      JOIN public.users cu ON cu.id = c.user_id
      LEFT JOIN public.users a ON a.id = c.assigned_advocate_id

      LEFT JOIN LATERAL (
        SELECT i.*
        FROM public.case_invoices i
        WHERE i.case_id = c.id
        ORDER BY i.created_at DESC NULLS LAST, i.id DESC
        LIMIT 1
      ) inv ON TRUE

      WHERE ${where.join(" AND ")}
      ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC, c.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
      `,
      values
    );

    const mapVoucherStatus = (invoiceStatus) => {
      const s = String(invoiceStatus || "").toUpperCase();
      if (!s) return "NOT_GENERATED";
      if (s === "VERIFIED" || s === "APPROVED" || s === "PAID") return "VERIFIED";
      if (s === "REJECTED") return "REJECTED";
      if (s === "PENDING") return "GENERATED";
      return "GENERATED";
    };

    const cases = rowsRes.rows.map((r) => ({
      id: `CASE-${r.id}`,
      title: r.title || "—",
      status: r.status,

      client: { name: r.client_name, city: "—", phone: "—" },

      advocate: r.advocate_id
        ? { assigned: true, name: r.advocate_name, phone: "—" }
        : { assigned: false },

      court: { name: "—", filedOn: "—" },
      nextHearing: null,
      nextMeeting: null,

      payments: {
        voucherStatus: r.invoice_id ? mapVoucherStatus(r.invoice_status) : "NOT_GENERATED",
        voucherId: r.voucher_id || null,
        amount: r.invoice_amount ?? null,
        dueDate: r.invoice_due_date ? String(r.invoice_due_date) : null,
      },

      alertsCount: r.alerts_count,
    }));

    return res.json({ total: totalRes.rows[0]?.total || 0, cases });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

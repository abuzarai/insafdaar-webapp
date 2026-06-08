import pool from "../../../db.js";

/**
 * GET /api/client/dashboard/cases
 * Query:
 *  - q (optional search)
 *  - status (optional: All or exact client_cases.status)
 *  - limit, offset
 *
 * ✅ Adds:
 *  - payments (from public.client_billing latest by case_id)
 *  - nextMeeting (from public.case_meetings nearest upcoming APPROVED by case_id)
 *
 * ⚠️ Court stays placeholder.
 */
export async function listMyCases(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { q = "", status = "All", limit = "50", offset = "0" } = req.query || {};
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    const where = [`c.user_id = $1`, `c.status <> 'ARCHIVED'`];
    const values = [userId];
    let idx = 1;

    if (status !== "All") {
      idx += 1;
      where.push(`c.status = $${idx}`);
      values.push(String(status));
    }

    if (String(q).trim()) {
      idx += 1;
      where.push(`(
        CAST(c.id AS TEXT) ILIKE $${idx}
        OR COALESCE(c.title,'') ILIKE $${idx}
        OR COALESCE(c.description,'') ILIKE $${idx}
      )`);
      values.push(`%${String(q).trim()}%`);
    }

    // total
    const totalRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.client_cases c
      WHERE ${where.join(" AND ")}
      `,
      values
    );

    // rows query (adds limit+offset)
    values.push(lim, off);

    const rowsRes = await pool.query(
      `
      SELECT
        c.id,
        c.title,
        c.status,
        c.source,
        c.language,
        c.created_at,
        c.updated_at,

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

        -- ✅ latest billing (voucher/payment info) for this case
        bill.id               AS billing_id,
        bill.amount           AS billing_amount,
        bill.status           AS billing_status,
        bill.due_date         AS billing_due_date,
        bill.voucher_pdf_url  AS billing_voucher_pdf_url,

        -- ✅ nearest upcoming approved meeting for this case
        meet.id               AS meeting_id,
        meet.start_at         AS meeting_start_at,
        meet.end_at           AS meeting_end_at,
        meet.google_meet_link AS meeting_link,
        meet.status           AS meeting_status

      FROM public.client_cases c
      JOIN public.users cu ON cu.id = c.user_id
      LEFT JOIN public.users a ON a.id = c.assigned_advocate_id

      LEFT JOIN LATERAL (
        SELECT b.*
        FROM public.client_billing b
        WHERE b.user_id = c.user_id
          AND b.case_id = c.id
        ORDER BY b.created_at DESC NULLS LAST, b.id DESC
        LIMIT 1
      ) bill ON TRUE

      LEFT JOIN LATERAL (
        SELECT m.*
        FROM public.case_meetings m
        WHERE m.case_id = c.id
          AND UPPER(m.status) = 'APPROVED'
          AND m.google_meet_link IS NOT NULL
          AND m.start_at > NOW()
        ORDER BY m.start_at ASC
        LIMIT 1
      ) meet ON TRUE

      WHERE ${where.join(" AND ")}
      ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC, c.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
      `,
      values
    );

    // map billing_status -> frontend voucherStatus enum
    const mapVoucherStatus = (billingStatus) => {
      const s = String(billingStatus || "").toUpperCase();
      if (!s) return "NOT_GENERATED";

      if (s === "VERIFIED" || s === "PAID_VERIFIED") return "VERIFIED";
      if (s === "REJECTED" || s === "PAYMENT_REJECTED") return "REJECTED";

      // ISSUED_PENDING_PAYMENT / PAYMENT_PROOF_UPLOADED / legacy statuses
      // => voucher exists but not verified
      return "GENERATED";
    };

    // ✅ local date + local time (NOT UTC)
    const formatDateLocal = (d) => {
      if (!d) return null;
      try {
        return new Date(d).toLocaleDateString();
      } catch {
        return String(d);
      }
    };

    const formatTimeLocal = (d) => {
      if (!d) return null;
      try {
        return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch {
        return null;
      }
    };

    const cases = rowsRes.rows.map((r) => ({
      id: `CASE-${r.id}`,
      title: r.title || "—",
      status: r.status || "DRAFT",

      client: {
        name: r.client_name || "—",
        city: "—",
        phone: "—",
      },

      advocate: r.advocate_id
        ? { assigned: true, name: r.advocate_name || "—", phone: "—" }
        : { assigned: false },

      // placeholders for now
      court: { name: "—", filedOn: "—" },
      nextHearing: null,

      // ✅ IMPORTANT: use undefined (not null) so TS "nextMeeting?" is satisfied
      nextMeeting: r.meeting_id
        ? {
            date: formatDateLocal(r.meeting_start_at),
            time: formatTimeLocal(r.meeting_start_at) || "—",
            mode: "Google Meet",
            link: r.meeting_link || undefined,
            status: "Scheduled",
          }
        : undefined,

      contractStatus: r.status || "DRAFT",

      // ✅ payments from client_billing (voucher)
      payments: {
        voucherStatus: r.billing_id ? mapVoucherStatus(r.billing_status) : "NOT_GENERATED",
        voucherId: r.billing_id ? String(r.billing_id) : null,
        amount: r.billing_amount ?? null,
        dueDate: r.billing_due_date ? formatDateLocal(r.billing_due_date) : null,
        voucherPdfUrl: r.billing_voucher_pdf_url || null,
      },

      alertsCount: r.alerts_count || 0,
    }));

    return res.json({
      total: totalRes.rows[0]?.total || 0,
      cases,
    });
  } catch (err) {
    console.error("listMyCases error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

/**
 * DELETE /api/client/dashboard/cases/:caseId
 * Hard delete for client-owned pre-active cases.
 * Related rows are removed via ON DELETE CASCADE.
 */
export async function deleteMyCase(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const caseId = Number(req.params.caseId);
    if (!Number.isFinite(caseId) || caseId <= 0) {
      return res.status(400).json({ error: "Invalid caseId" });
    }

    const allowedStatuses = [
      "DRAFT",
      "INTAKE_STARTED",
      "MATCHING_REVIEW",
      "ADVOCATE_ASSIGNED",
    ];

    const lockRes = await pool.query(
      `
      SELECT id, status
      FROM public.client_cases
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
      `,
      [caseId, userId]
    );

    const row = lockRes.rows[0];
    if (!row) return res.status(404).json({ error: "Case not found" });

    const currentStatus = String(row.status || "").toUpperCase();
    if (!allowedStatuses.includes(currentStatus)) {
      return res.status(409).json({
        error: "Case cannot be deleted at current stage",
        currentStatus,
      });
    }

    const delRes = await pool.query(
      `
      DELETE FROM public.client_cases
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [caseId, userId]
    );

    if (!delRes.rows[0]) {
      return res.status(404).json({ error: "Case not found" });
    }

    return res.json({ message: "Case deleted permanently" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete case" });
  }
}

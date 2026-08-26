import pool from "../../../../db.js";
import { sendNotificationEmail } from "../../../../utils/mailer.js"; // FIXED PATH

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// These must match your enum advocate_document_type values
const REQUIRED_DOC_TYPES = ["CnicFront", "CnicBack", "BarLicense", "Degree"];

// build file url
function toFileUrl(req, filePath) {
  if (!filePath) return null;
  return `${req.protocol}://${req.get("host")}/${String(filePath).replace(/\\/g, "/")}`;
}

/* ===================== email helpers ===================== */

async function getUserBasic(userId) {
  const r = await pool.query(
    `SELECT id, name, email FROM public.users WHERE id=$1 LIMIT 1`,
    [userId]
  );
  return r.rows?.[0] || null;
}

async function emailBestEffort({ to, subject, title, message }) {
  if (!to) return;
  await sendNotificationEmail({ to, subject, title, message }).catch(() => {});
}

/* ===================== helpers: ensure rows ===================== */

async function ensureProfileRow(userId) {
  await pool.query(
    `
    INSERT INTO advocate_profiles (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

async function ensureAvailabilitySettingsRow(userId) {
  await pool.query(
    `
    INSERT INTO advocate_availability_settings
      (user_id, mode, slot_minutes, buffer_minutes, max_bookings_per_day,
       meeting_link, default_location, notes_to_clients, appointment_types)
    VALUES
      ($1, 'Hybrid', 30, 10, 8, NULL, NULL, '', '{}'::jsonb)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

async function ensureWeeklySchedule(userId) {
  for (const day of DAYS) {
    const enabled = day === "Sun" ? false : true;

    const ins = await pool.query(
      `
      INSERT INTO advocate_weekly_schedule (user_id, day_key, enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, day_key) DO UPDATE SET enabled = advocate_weekly_schedule.enabled
      RETURNING id
      `,
      [userId, day, enabled]
    );

    const scheduleId = ins.rows[0]?.id;
    if (!scheduleId) continue;

    const win = await pool.query(
      `SELECT id FROM advocate_schedule_windows WHERE schedule_id=$1 LIMIT 1`,
      [scheduleId]
    );

    if (win.rowCount === 0) {
      await pool.query(
        `
        INSERT INTO advocate_schedule_windows (schedule_id, time_from, time_to, sort_order)
        VALUES ($1, '16:00', '21:00', 0)
        `,
        [scheduleId]
      );
    }
  }
}

async function ensureDefaultDocs(userId) {
  const docTypes = ["CnicFront", "CnicBack", "BarLicense", "Degree", "experienceLetter"];
  for (const docType of docTypes) {
    await pool.query(
      `
      INSERT INTO advocate_verification_documents (user_id, doc_type, status)
      VALUES ($1, $2, 'Not Uploaded')
      ON CONFLICT (user_id, doc_type) DO NOTHING
      `,
      [userId, docType]
    );
  }
}

async function getDaySchedules(userId) {
  const sched = await pool.query(
    `
    SELECT id, day_key, enabled
    FROM advocate_weekly_schedule
    WHERE user_id=$1
    ORDER BY
      CASE day_key
        WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4
        WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6 WHEN 'Sun' THEN 7
        ELSE 8
      END
    `,
    [userId]
  );

  const daySchedules = {};
  for (const row of sched.rows) {
    const windowsR = await pool.query(
      `
      SELECT time_from, time_to
      FROM advocate_schedule_windows
      WHERE schedule_id=$1
      ORDER BY sort_order ASC, id ASC
      `,
      [row.id]
    );

    daySchedules[row.day_key] = {
      enabled: !!row.enabled,
      windows: windowsR.rows.map((w) => ({
        from: String(w.time_from).slice(0, 5),
        to: String(w.time_to).slice(0, 5),
      })),
    };
  }

  for (const d of DAYS) {
    if (!daySchedules[d]) {
      daySchedules[d] = {
        enabled: d === "Sun" ? false : true,
        windows: [{ from: "16:00", to: "21:00" }],
      };
    }
  }

  return daySchedules;
}

async function getApprovalReadiness(userId) {
  const r = await pool.query(
    `
    SELECT doc_type, status
    FROM advocate_verification_documents
    WHERE user_id=$1 AND doc_type = ANY($2::advocate_document_type[])
    `,
    [userId, REQUIRED_DOC_TYPES]
  );

  const map = new Map(r.rows.map((x) => [x.doc_type, x.status]));
  const missing = REQUIRED_DOC_TYPES.filter((t) => !map.has(t));
  const notVerified = REQUIRED_DOC_TYPES.filter((t) => map.get(t) !== "Verified");

  return { ready: missing.length === 0 && notVerified.length === 0, missing, notVerified };
}

/* ===================== existing: list advocates ===================== */

/**
 * GET /api/admin/advocates?q=
 * Returns: { advocates: AdvocateRow[] }
 */
export async function getAdminAdvocates(req, res) {
  try {
    const qRaw = String(req.query.q || "").trim();
    const q = qRaw.toLowerCase();

    const params = [];
    let where = `LOWER(u.role) = 'advocate'`;

    if (q) {
      params.push(`%${q}%`);
      where += ` AND (
        LOWER(COALESCE(u.name, '')) LIKE $1
        OR LOWER(u.email) LIKE $1
        OR LOWER(COALESCE(ap.phone, '')) LIKE $1
      )`;
    }

    const sql = `
      SELECT
        u.id,
        u.name AS name,
        u.email,
        ap.phone,
        u.role,
        u.created_at,

        ap.headline,
        ap.experience_years,
        ap.bar_council_id,
        ap.city,
        ap.court,
        ap.languages,
        ap.practice_areas,
        ap.public_profile_enabled,

        ap.is_verified,
        ap.verified_at,
        ap.verified_by_admin_id,
        ap.verification_note
      FROM users u
      LEFT JOIN advocate_profiles ap ON ap.user_id = u.id
      WHERE ${where}
      ORDER BY u.id DESC
    `;

    const r = await pool.query(sql, params);
    return res.json({ advocates: r.rows });
  } catch (e) {
    console.error("getAdminAdvocates error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* ===================== existing: patch advocate ===================== */

/**
 * PATCH /api/admin/advocates/:id
 */
export async function patchAdminAdvocate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const {
      // users fields
      name,
      email,

      // profile fields
      phone,
      headline,
      experience_years,
      bar_council_id,
      city,
      court,
      languages,
      practice_areas,
      bio,
      public_profile_enabled,
    } = req.body || {};

    // Ensure this is an advocate user
    const uCheck = await pool.query(
      `SELECT id FROM users WHERE id=$1 AND LOWER(role)='advocate'`,
      [id]
    );
    if (!uCheck.rowCount) return res.status(404).json({ error: "Advocate not found" });

    // 1) Update USERS (name/email) if provided
    if (name != null || email != null) {
      await pool.query(
        `
        UPDATE users
        SET
          name = COALESCE($2, name),
          email = COALESCE($3, email)
        WHERE id = $1 AND LOWER(role)='advocate'
        `,
        [id, name ?? null, email ?? null]
      );
    }

    // 2) Ensure advocate_profiles row exists
    await pool.query(
      `
      INSERT INTO advocate_profiles (user_id, created_at, updated_at)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
      `,
      [id]
    );

    // 3) Update advocate_profiles
    await pool.query(
      `
      UPDATE advocate_profiles
      SET
        phone = COALESCE($2, phone),
        headline = COALESCE($3, headline),
        experience_years = COALESCE($4, experience_years),
        bar_council_id = COALESCE($5, bar_council_id),
        city = COALESCE($6, city),
        court = COALESCE($7, court),
        languages = COALESCE($8::text[], languages),
        practice_areas = COALESCE($9::text[], practice_areas),
        bio = COALESCE($10, bio),
        public_profile_enabled = COALESCE($11, public_profile_enabled),
        updated_at = NOW()
      WHERE user_id = $1
      `,
      [
        id,
        phone ?? null,
        headline ?? null,
        experience_years ?? null,
        bar_council_id ?? null,
        city ?? null,
        court ?? null,
        Array.isArray(languages) ? languages : null,
        Array.isArray(practice_areas) ? practice_areas : null,
        bio ?? null,
        typeof public_profile_enabled === "boolean" ? public_profile_enabled : null,
      ]
    );

    // 4) Return merged row
    const merged = await pool.query(
      `
      SELECT
        u.id,
        u.name AS name,
        u.email,
        ap.phone,
        u.role,
        u.created_at,

        ap.headline,
        ap.experience_years,
        ap.bar_council_id,
        ap.city,
        ap.court,
        ap.languages,
        ap.practice_areas,
        ap.public_profile_enabled,

        ap.is_verified,
        ap.verified_at,
        ap.verified_by_admin_id,
        ap.verification_note
      FROM users u
      LEFT JOIN advocate_profiles ap ON ap.user_id = u.id
      WHERE u.id = $1 AND LOWER(u.role)='advocate'
      `,
      [id]
    );

    return res.json({ advocate: merged.rows[0] });
  } catch (e) {
    console.error("patchAdminAdvocate error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* ===================== existing: delete advocate ===================== */

/**
 * DELETE /api/admin/advocates/:id
 */
export async function deleteAdminAdvocate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    await pool.query(`DELETE FROM advocate_profiles WHERE user_id=$1`, [id]);

    const del = await pool.query(
      `DELETE FROM users WHERE id=$1 AND LOWER(role)='advocate'`,
      [id]
    );

    if (!del.rowCount) return res.status(404).json({ error: "Advocate not found" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteAdminAdvocate error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* ===================== ✅ NEW: full profile view ===================== */

/**
 * GET /api/admin/advocates/:id/full-profile
 * Returns: { profile, availability, documents, workHistory, education }
 */
export async function getAdminAdvocateFullProfile(req, res) {
  const advocateId = Number(req.params.id);
  if (!Number.isFinite(advocateId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const uRole = await pool.query(
      `SELECT id, role, name, email FROM users WHERE id=$1`,
      [advocateId]
    );
    if (!uRole.rowCount || String(uRole.rows[0].role).toLowerCase() !== "advocate") {
      return res.status(404).json({ error: "Advocate not found" });
    }

    await ensureProfileRow(advocateId);
    await ensureAvailabilitySettingsRow(advocateId);
    await ensureWeeklySchedule(advocateId);
    await ensureDefaultDocs(advocateId);

    const profileR = await pool.query(`SELECT * FROM advocate_profiles WHERE user_id=$1`, [advocateId]);
    const availR = await pool.query(`SELECT * FROM advocate_availability_settings WHERE user_id=$1`, [advocateId]);
    const daySchedules = await getDaySchedules(advocateId);

    const docsR = await pool.query(
      `
      SELECT doc_type, file_path, status, admin_note, last_updated_at, reviewed_at, reviewed_by_admin_id
      FROM advocate_verification_documents
      WHERE user_id=$1
      ORDER BY doc_type
      `,
      [advocateId]
    );

    const workR = await pool.query(
      `
      SELECT id, org, role, from_year, to_year, location, highlights
      FROM advocate_work_history
      WHERE user_id=$1
      ORDER BY id DESC
      `,
      [advocateId]
    );

    const eduR = await pool.query(
      `
      SELECT id, Degree, institute, year
      FROM advocate_education
      WHERE user_id=$1
      ORDER BY id DESC
      `,
      [advocateId]
    );

    const u = uRole.rows[0] || {};
    const p = profileR.rows[0] || {};
    const a = availR.rows[0] || {};
    const readiness = await getApprovalReadiness(advocateId);

    return res.json({
      profile: {
        id: advocateId,
        name: u.name ?? null,
        email: u.email ?? null,
        phone: p.phone ?? null,
        headline: p.headline ?? null,
        experienceYears: p.experience_years ?? 0,
        barCouncilId: p.bar_council_id ?? null,
        city: p.city ?? null,
        court: p.court ?? null,
        languages: p.languages ?? [],
        practiceAreas: p.practice_areas ?? [],
        bio: p.bio ?? null,
        avatarUrl: p.avatar_url ?? null,
        publicProfileEnabled: p.public_profile_enabled ?? true,

        isVerified: !!p.is_verified,
        verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
        verifiedByAdminId: p.verified_by_admin_id ?? null,
        verificationNote: p.verification_note ?? null,

        readyForApproval: readiness.ready,
        missingRequiredDocs: readiness.missing,
        notVerifiedRequiredDocs: readiness.notVerified,
      },
      availability: {
        mode: a.mode ?? "Hybrid",
        slotMinutes: a.slot_minutes ?? 30,
        bufferMinutes: a.buffer_minutes ?? 10,
        maxBookingsPerDay: a.max_bookings_per_day ?? 8,
        meetingLink: a.meeting_link ?? "",
        defaultLocation: a.default_location ?? "",
        appointmentTypes: a.appointment_types ?? {},
        notesToClients: a.notes_to_clients ?? "",
        daySchedules,
      },
      documents: docsR.rows.map((d) => ({
        key: d.doc_type,
        status: d.status,
        lastUpdated: d.last_updated_at ? new Date(d.last_updated_at).toISOString() : null,
        reviewedAt: d.reviewed_at ? new Date(d.reviewed_at).toISOString() : null,
        reviewedByAdminId: d.reviewed_by_admin_id ?? null,
        note: d.admin_note || null,
        fileUrl: toFileUrl(req, d.file_path),
      })),
      workHistory: workR.rows,
      education: eduR.rows,
    });
  } catch (e) {
    console.error("getAdminAdvocateFullProfile error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* ===================== ✅ NEW: admin verifies document ===================== */

/**
 * PATCH /api/admin/advocates/:id/documents/:docType
 * Body: { status: "Verified"|"Rejected"|"Pending", admin_note?: string }
 */
export async function patchAdminAdvocateDocument(req, res) {
  const advocateId = Number(req.params.id);
  const docType = String(req.params.docType || "").trim();

  if (!Number.isFinite(advocateId)) return res.status(400).json({ error: "Invalid id" });
  if (!docType) return res.status(400).json({ error: "Invalid docType" });

  const { status, admin_note } = req.body || {};
  const allowed = new Set(["Verified", "Rejected", "Pending"]);
  if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status" });

  try {
    const uCheck = await pool.query(
      `SELECT id FROM users WHERE id=$1 AND LOWER(role)='advocate'`,
      [advocateId]
    );
    if (!uCheck.rowCount) return res.status(404).json({ error: "Advocate not found" });

    const r = await pool.query(
      `
      UPDATE advocate_verification_documents
      SET
        status = $3::verification_status,
        reviewed_by_admin_id = $2,
        reviewed_at = NOW(),
        admin_note = COALESCE($4, admin_note),
        last_updated_at = NOW()
      WHERE user_id = $1 AND doc_type = $5::advocate_document_type
      RETURNING doc_type, status, admin_note, reviewed_by_admin_id, reviewed_at, last_updated_at, file_path
      `,
      [advocateId, req.user.id, status, admin_note ?? null, docType]
    );

    if (!r.rowCount) return res.status(404).json({ error: "Document row not found" });

    // If doc becomes non-verified => ensure advocate is NOT verified
    if (status !== "Verified") {
      await pool.query(
        `
        UPDATE advocate_profiles
        SET is_verified=false, verified_at=NULL, verified_by_admin_id=NULL
        WHERE user_id=$1
        `,
        [advocateId]
      );
    }

    // ✅ Email advocate when a document is REJECTED (best effort)
    if (status === "Rejected") {
      const user = await getUserBasic(advocateId);
      await emailBestEffort({
        to: user?.email,
        subject: "Document Rejected - Action Required",
        title: "One of your verification documents was rejected",
        message: `
          <p>Hi ${user?.name || "Advocate"},</p>
          <p>Your document <b>${docType}</b> was marked as <b>Rejected</b>.</p>
          ${admin_note ? `<p><b>Admin Note:</b> ${admin_note}</p>` : ""}
          <p>Please re-upload the correct document in your dashboard so we can verify it.</p>
          <p>Regards,<br/><b>Team Insafdaar</b></p>
        `,
      });
    }

    return res.json({
      document: {
        key: r.rows[0].doc_type,
        status: r.rows[0].status,
        note: r.rows[0].admin_note ?? null,
        reviewedAt: r.rows[0].reviewed_at ? new Date(r.rows[0].reviewed_at).toISOString() : null,
        reviewedByAdminId: r.rows[0].reviewed_by_admin_id ?? null,
        lastUpdated: r.rows[0].last_updated_at ? new Date(r.rows[0].last_updated_at).toISOString() : null,
        fileUrl: toFileUrl(req, r.rows[0].file_path),
      },
    });
  } catch (e) {
    console.error("patchAdminAdvocateDocument error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/* ===================== ✅ NEW: approve / unapprove advocate ===================== */

/**
 * POST /api/admin/advocates/:id/approve
 * Body: { verification_note?: string }
 */
export async function approveAdvocate(req, res) {
  const advocateId = Number(req.params.id);
  if (!Number.isFinite(advocateId)) return res.status(400).json({ error: "Invalid id" });

  const { verification_note } = req.body || {};

  try {
    const uCheck = await pool.query(
      `SELECT id FROM users WHERE id=$1 AND LOWER(role)='advocate'`,
      [advocateId]
    );
    if (!uCheck.rowCount) return res.status(404).json({ error: "Advocate not found" });

    const readiness = await getApprovalReadiness(advocateId);
    if (!readiness.ready) {
      return res.status(400).json({
        error: "Cannot approve until all required documents are Verified",
        missing: readiness.missing,
        notVerified: readiness.notVerified,
      });
    }

    await pool.query(
      `
      UPDATE advocate_profiles
      SET
        is_verified=true,
        verified_at=NOW(),
        verified_by_admin_id=$2,
        verification_note=$3,
        updated_at=NOW()
      WHERE user_id=$1
      `,
      [advocateId, req.user.id, verification_note ?? null]
    );

    // ✅ Email advocate: approved (best effort)
    const user = await getUserBasic(advocateId);
    await emailBestEffort({
      to: user?.email,
      subject: "Advocate Account Approved",
      title: "Your advocate account has been approved",
      message: `
        <p>Hi ${user?.name || "Advocate"},</p>
        <p>Congratulations! Your advocate profile has been <b>approved</b> and your account is now <b>verified</b>.</p>
        ${verification_note ? `<p><b>Admin Note:</b> ${verification_note}</p>` : ""}
        <p>You can now start receiving clients through Insafdaar.</p>
        <p>Regards,<br/><b>Team Insafdaar</b></p>
      `,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("approveAdvocate error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

/**
 * POST /api/admin/advocates/:id/unapprove
 * Body: { verification_note?: string }
 */
export async function unapproveAdvocate(req, res) {
  const advocateId = Number(req.params.id);
  if (!Number.isFinite(advocateId)) return res.status(400).json({ error: "Invalid id" });

  const { verification_note } = req.body || {};

  try {
    await pool.query(
      `
      UPDATE advocate_profiles
      SET
        is_verified=false,
        verified_at=NULL,
        verified_by_admin_id=NULL,
        verification_note=$2,
        updated_at=NOW()
      WHERE user_id=$1
      `,
      [advocateId, verification_note ?? null]
    );

    // ✅ Email advocate: unapproved/rejected (best effort)
    const user = await getUserBasic(advocateId);
    await emailBestEffort({
      to: user?.email,
      subject: "Advocate Verification Update",
      title: "Your advocate verification was not approved",
      message: `
        <p>Hi ${user?.name || "Advocate"},</p>
        <p>Your advocate account is currently <b>not verified</b>.</p>
        ${verification_note ? `<p><b>Admin Note:</b> ${verification_note}</p>` : ""}
        <p>Please review your documents/profile and re-submit for verification.</p>
        <p>Regards,<br/><b>Team Insafdaar</b></p>
      `,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("unapproveAdvocate error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}

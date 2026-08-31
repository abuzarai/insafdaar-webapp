import pool from "../../../db.js";

// Frontend doc keys -> DB enum values (advocate_document_type)
const DOC_MAP = {
  CnicFront: "CnicFront",
  CnicBack: "CnicBack",
  BarLicense: "BarLicense",
  Degree: "Degree",
  experienceLetter: "experienceLetter",
};

const DOC_KEYS = new Set(Object.keys(DOC_MAP));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Required docs for approval
const REQUIRED_DOC_TYPES = ["CnicFront", "CnicBack", "BarLicense", "Degree"];

/**
 * Ensure advocate_profiles row exists (profile extras live here)
 * NOTE: name/email live in users table in your DB
 */
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

/**
 * Ensure advocate_availability_settings exists (general availability settings)
 */
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

/**
 * Ensure weekly schedule rows exist for Mon..Sun
 * (enabled true for Mon-Sat, false for Sun to match your defaults)
 * Ensure at least one default window per day
 */
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

/**
 * Ensure verification docs rows exist for all doc types
 */
async function ensureDefaultDocs(userId) {
  for (const key of Object.keys(DOC_MAP)) {
    const docType = DOC_MAP[key];
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

/**
 * Build daySchedules shape for frontend from advocate_weekly_schedule + advocate_schedule_windows
 */
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

/**
 * Replace all schedule windows from frontend payload
 */
async function saveDaySchedules(userId, daySchedules) {
  for (const day of DAYS) {
    const dayObj = daySchedules?.[day];
    const enabled = dayObj ? !!dayObj.enabled : day === "Sun" ? false : true;

    const schedRow = await pool.query(
      `
      INSERT INTO advocate_weekly_schedule (user_id, day_key, enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, day_key)
      DO UPDATE SET enabled=EXCLUDED.enabled
      RETURNING id
      `,
      [userId, day, enabled]
    );

    const scheduleId = schedRow.rows[0].id;

    await pool.query(`DELETE FROM advocate_schedule_windows WHERE schedule_id=$1`, [
      scheduleId,
    ]);

    const windows =
      Array.isArray(dayObj?.windows) && dayObj.windows.length
        ? dayObj.windows
        : [{ from: "16:00", to: "21:00" }];

    let idx = 0;
    for (const w of windows) {
      const from = w?.from || "16:00";
      const to = w?.to || "21:00";

      await pool.query(
        `
        INSERT INTO advocate_schedule_windows (schedule_id, time_from, time_to, sort_order)
        VALUES ($1, $2::time, $3::time, $4)
        `,
        [scheduleId, from, to, idx]
      );
      idx += 1;
    }
  }
}

/**
 * Helper: build fileUrl
 */
function toFileUrl(req, filePath) {
  if (!filePath) return null;
  return `${req.protocol}://${req.get("host")}/${String(filePath).replace(/\\/g, "/")}`;
}

/**
 * Helper: get advocate approval readiness (required docs verified?)
 */
// async function getApprovalReadiness(userId) {
//   const r = await pool.query(
//     `
//     SELECT doc_type, status
//     FROM advocate_verification_documents
//     WHERE user_id=$1 AND doc_type = ANY($2::advocate_document_type[])
//     `,
//     [userId, REQUIRED_DOC_TYPES]
//   );

//   const map = new Map(r.rows.map((x) => [x.doc_type, x.status]));
//   const missing = REQUIRED_DOC_TYPES.filter((t) => !map.has(t));
//   const notVerified = REQUIRED_DOC_TYPES.filter((t) => map.get(t) !== "Verified");

//   return { missing, notVerified, ready: missing.length === 0 && notVerified.length === 0 };
// }

async function getApprovalReadiness(userId) {
  // Ensure the document types are in the correct format (camelCase)
  const docTypesArray = REQUIRED_DOC_TYPES.map(doc => doc.charAt(0).toUpperCase() + doc.slice(1)); // Capitalize first letter

  // Query the database with explicit type casting
  const r = await pool.query(
    `
    SELECT doc_type, status
    FROM advocate_verification_documents
    WHERE user_id=$1 AND doc_type = ANY($2::advocate_document_type[])
    `,
    [userId, docTypesArray]  // Pass the array as the second argument
  );

  // Map the doc types to their statuses
  const map = new Map(r.rows.map((x) => [x.doc_type, x.status]));

  // Identify missing and not verified document types
  const missing = docTypesArray.filter((t) => !map.has(t));
  const notVerified = docTypesArray.filter((t) => map.get(t) !== "Verified");

  // Return the readiness status
  return { missing, notVerified, ready: missing.length === 0 && notVerified.length === 0 };
}

/**
 * -------- Advocate Controllers ----------
 */

export async function getFullProfile(req, res) {
  try {
    const userId = req.user.id;

    await ensureProfileRow(userId);
    await ensureAvailabilitySettingsRow(userId);
    await ensureWeeklySchedule(userId);
    await ensureDefaultDocs(userId);

    const userR = await pool.query(`SELECT id, name, email FROM users WHERE id=$1`, [
      userId,
    ]);

    const profileR = await pool.query(
      `SELECT * FROM advocate_profiles WHERE user_id=$1`,
      [userId]
    );

    // ✅ Registration prefill: bar_id/specialization/experience were captured at
    // signup into advocate_details — use them as fallbacks until the profile
    // has its own values.
    const detailsR = await pool.query(
      `SELECT bar_id, specialization, experience FROM advocate_details WHERE user_id=$1`,
      [userId]
    );
    const regDetails = detailsR.rows[0] || {};

    const availR = await pool.query(
      `SELECT * FROM advocate_availability_settings WHERE user_id=$1`,
      [userId]
    );

    const daySchedules = await getDaySchedules(userId);

    const docsR = await pool.query(
      `
      SELECT doc_type, file_path, status, admin_note, last_updated_at, reviewed_at, reviewed_by_admin_id
      FROM advocate_verification_documents
      WHERE user_id=$1
      ORDER BY doc_type
      `,
      [userId]
    );

    const workR = await pool.query(
      `
      SELECT id, org, role, from_year, to_year, location, highlights
      FROM advocate_work_history
      WHERE user_id=$1
      ORDER BY id DESC
      `,
      [userId]
    );

    const eduR = await pool.query(
      `
      SELECT id, Degree, institute, year
      FROM advocate_education
      WHERE user_id=$1
      ORDER BY id DESC
      `,
      [userId]
    );

    const u = userR.rows[0] || {};
    const p = profileR.rows[0] || {};
    const a = availR.rows[0] || {};

    const readiness = await getApprovalReadiness(userId);

    const profile = {
      name: u.name ?? null,
      email: u.email ?? null,
      phone: p.phone ?? null,
      headline: p.headline ?? null,
      experienceYears:
        p.experience_years > 0
          ? p.experience_years
          : Number.parseInt(regDetails.experience, 10) || 0,
      barCouncilId: p.bar_council_id ?? regDetails.bar_id ?? null,
      city: p.city ?? null,
      court: p.court ?? null,
      languages: p.languages ?? [],
      practiceAreas:
        Array.isArray(p.practice_areas) && p.practice_areas.length > 0
          ? p.practice_areas
          : regDetails.specialization
          ? [regDetails.specialization]
          : [],
      bio: p.bio ?? null,
      avatarUrl: p.avatar_url ?? null,
      publicProfileEnabled: p.public_profile_enabled ?? true,

      // ✅ verification fields (new)
      isVerified: !!p.is_verified,
      verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
      verifiedByAdminId: p.verified_by_admin_id ?? null,
      verificationNote: p.verification_note ?? null,

      // ✅ helpful flags for frontend
      readyForApproval: readiness.ready,
      missingRequiredDocs: readiness.missing,
      notVerifiedRequiredDocs: readiness.notVerified,
    };

    const availability = {
      mode: a.mode ?? "Hybrid",
      slotMinutes: a.slot_minutes ?? 30,
      bufferMinutes: a.buffer_minutes ?? 10,
      maxBookingsPerDay: a.max_bookings_per_day ?? 8,
      meetingLink: a.meeting_link ?? "",
      defaultLocation: a.default_location ?? "",
      appointmentTypes: a.appointment_types ?? {
        "Client Meeting": true,
        "Court Appearance": true,
        "Office Visit": false,
      },
      notesToClients: a.notes_to_clients ?? "",
      daySchedules,
    };

    const documents = docsR.rows.map((d) => ({
      key: d.doc_type,
      status: d.status,
      lastUpdated: d.last_updated_at ? new Date(d.last_updated_at).toISOString() : null,
      reviewedAt: d.reviewed_at ? new Date(d.reviewed_at).toISOString() : null,
      reviewedByAdminId: d.reviewed_by_admin_id ?? null,
      note: d.admin_note || null,
      fileUrl: toFileUrl(req, d.file_path),
    }));

    return res.json({
      profile,
      availability,
      documents,
      workHistory: workR.rows,
      education: eduR.rows,
    });
  } catch (e) {
    console.error("getFullProfile error:", e);
    return res.status(500).json({ error: "Server error loading profile" });
  }
}

export async function patchProfile(req, res) {
  try {
    const userId = req.user.id;

    const {
      name,
      email,
      phone,
      headline,
      experienceYears,
      barCouncilId,
      city,
      court,
      languages,
      practiceAreas,
      bio,
      avatarUrl,
    } = req.body || {};

    await ensureProfileRow(userId);

    if (name != null || email != null) {
      await pool.query(
        `
        UPDATE users
        SET
          name = COALESCE($2, name),
          email = COALESCE($3, email)
        WHERE id=$1
        `,
        [userId, name ?? null, email ?? null]
      );
    }

    const updated = await pool.query(
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
        avatar_url = COALESCE($11, avatar_url),
        updated_at = NOW()
      WHERE user_id=$1
      RETURNING *
      `,
      [
        userId,
        phone ?? null,
        headline ?? null,
        Number.isFinite(Number(experienceYears)) ? Number(experienceYears) : null,
        barCouncilId ?? null,
        city ?? null,
        court ?? null,
        Array.isArray(languages) ? languages : null,
        Array.isArray(practiceAreas) ? practiceAreas : null,
        bio ?? null,
        avatarUrl ?? null,
      ]
    );

    const u = await pool.query(`SELECT name, email FROM users WHERE id=$1`, [userId]);
    const p = updated.rows[0] || {};

    return res.json({
      profile: {
        name: u.rows[0]?.name ?? null,
        email: u.rows[0]?.email ?? null,
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

        // verification
        isVerified: !!p.is_verified,
        verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
        verifiedByAdminId: p.verified_by_admin_id ?? null,
        verificationNote: p.verification_note ?? null,
      },
    });
  } catch (e) {
    console.error("patchProfile error:", e);
    return res.status(500).json({ error: "Server error updating profile" });
  }
}

export async function getDocuments(req, res) {
  try {
    const userId = req.user.id;
    await ensureDefaultDocs(userId);

    const r = await pool.query(
      `
      SELECT doc_type, file_path, status, admin_note, last_updated_at, reviewed_at, reviewed_by_admin_id
      FROM advocate_verification_documents
      WHERE user_id=$1
      ORDER BY doc_type
      `,
      [userId]
    );

    const documents = r.rows.map((d) => ({
      key: d.doc_type,
      status: d.status,
      lastUpdated: d.last_updated_at ? new Date(d.last_updated_at).toISOString() : null,
      reviewedAt: d.reviewed_at ? new Date(d.reviewed_at).toISOString() : null,
      reviewedByAdminId: d.reviewed_by_admin_id ?? null,
      note: d.admin_note || null,
      fileUrl: toFileUrl(req, d.file_path),
    }));

    return res.json({ documents });
  } catch (e) {
    console.error("getDocuments error:", e);
    return res.status(500).json({ error: "Server error loading documents" });
  }
}

export async function uploadDocument(req, res) {
  try {
    const userId = req.user.id;
    const { docKey } = req.params;

    if (!DOC_KEYS.has(docKey)) return res.status(400).json({ error: "Invalid document key" });
    if (!req.file) return res.status(400).json({ error: "File is required" });

    await ensureDefaultDocs(userId);

    const relative = req.file.path.replace(process.cwd(), "").replace(/^[\\/]/, "");
    const docType = DOC_MAP[docKey];

    const updated = await pool.query(
      `
      INSERT INTO advocate_verification_documents
        (user_id, doc_type, file_path, original_name, mime_type, file_size_bytes, status, uploaded_at, last_updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'Pending', NOW(), NOW())
      ON CONFLICT (user_id, doc_type)
      DO UPDATE SET
        file_path=EXCLUDED.file_path,
        original_name=EXCLUDED.original_name,
        mime_type=EXCLUDED.mime_type,
        file_size_bytes=EXCLUDED.file_size_bytes,
        status='Pending',
        uploaded_at=NOW(),
        last_updated_at=NOW()
      RETURNING doc_type, file_path, status, admin_note, last_updated_at
      `,
      [userId, docType, relative, req.file.originalname || null, req.file.mimetype || null, req.file.size || null]
    );

    // If advocate was verified earlier, uploading again means re-review required
    await pool.query(
      `
      UPDATE advocate_profiles
      SET is_verified=false, verified_at=NULL, verified_by_admin_id=NULL
      WHERE user_id=$1
      `,
      [userId]
    );

    const row = updated.rows[0];
    return res.json({
      document: {
        key: row.doc_type,
        status: row.status,
        lastUpdated: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null,
        note: row.admin_note || null,
        fileUrl: toFileUrl(req, row.file_path),
      },
    });
  } catch (e) {
    console.error("uploadDocument error:", e);
    return res.status(500).json({ error: "Server error uploading document" });
  }
}



/**
 * -------- Admin Controllers ----------
 * (Add adminAuth middleware on routes)
 */

// Admin can view full profile of any advocate
export async function getAdminAdvocateFullProfile(req, res) {
  const advocateId = Number(req.params.id);
  if (!Number.isFinite(advocateId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const uRole = await pool.query(`SELECT id, role FROM users WHERE id=$1`, [advocateId]);
    if (!uRole.rowCount || String(uRole.rows[0].role).toLowerCase() !== "advocate") {
      return res.status(404).json({ error: "Advocate not found" });
    }

    await ensureProfileRow(advocateId);
    await ensureAvailabilitySettingsRow(advocateId);
    await ensureWeeklySchedule(advocateId);
    await ensureDefaultDocs(advocateId);

    // reuse getFullProfile style but for given id
    const userR = await pool.query(`SELECT id, name, email FROM users WHERE id=$1`, [advocateId]);
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

    const u = userR.rows[0] || {};
    const p = profileR.rows[0] || {};
    const a = availR.rows[0] || {};
    const readiness = await getApprovalReadiness(advocateId);

    return res.json({
      profile: {
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
    return res.status(500).json({ error: "Server error" });
  }
}

// Admin verify/reject a document
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

    // if doc rejected/pending -> advocate must be unverified
    if (status !== "Verified") {
      await pool.query(
        `
        UPDATE advocate_profiles
        SET
          is_verified=false,
          verified_at=NULL,
          verified_by_admin_id=NULL
        WHERE user_id=$1
        `,
        [advocateId]
      );
    }

    return res.json({ document: r.rows[0] });
  } catch (e) {
    console.error("patchAdminAdvocateDocument error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

// Admin approves advocate (only if required docs verified)
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

    return res.json({ ok: true });
  } catch (e) {
    console.error("approveAdvocate error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

// Optional: admin revoke verification
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

    return res.json({ ok: true });
  } catch (e) {
    console.error("unapproveAdvocate error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}

/**
 * -------- Availability endpoints (unchanged) ----------
 */

export async function getAvailability(req, res) {
  try {
    const userId = req.user.id;

    await ensureAvailabilitySettingsRow(userId);
    await ensureWeeklySchedule(userId);

    const a = await pool.query(
      `SELECT * FROM advocate_availability_settings WHERE user_id=$1`,
      [userId]
    );
    const daySchedules = await getDaySchedules(userId);

    const row = a.rows[0] || {};
    return res.json({
      availability: {
        mode: row.mode ?? "Hybrid",
        slotMinutes: row.slot_minutes ?? 30,
        bufferMinutes: row.buffer_minutes ?? 10,
        maxBookingsPerDay: row.max_bookings_per_day ?? 8,
        meetingLink: row.meeting_link ?? "",
        defaultLocation: row.default_location ?? "",
        appointmentTypes: row.appointment_types ?? {},
        notesToClients: row.notes_to_clients ?? "",
        daySchedules,
      },
    });
  } catch (e) {
    console.error("getAvailability error:", e);
    return res.status(500).json({ error: "Server error loading availability" });
  }
}

export async function putAvailability(req, res) {
  try {
    const userId = req.user.id;

    const {
      mode,
      slotMinutes,
      bufferMinutes,
      maxBookingsPerDay,
      meetingLink,
      defaultLocation,
      appointmentTypes,
      notesToClients,
      daySchedules,
    } = req.body || {};

    await ensureAvailabilitySettingsRow(userId);
    await ensureWeeklySchedule(userId);

    const updated = await pool.query(
      `
      UPDATE advocate_availability_settings
      SET
        mode = COALESCE($2, mode),
        slot_minutes = COALESCE($3, slot_minutes),
        buffer_minutes = COALESCE($4, buffer_minutes),
        max_bookings_per_day = COALESCE($5, max_bookings_per_day),
        meeting_link = $6,
        default_location = $7,
        appointment_types = COALESCE($8::jsonb, appointment_types),
        notes_to_clients = COALESCE($9, notes_to_clients),
        updated_at = NOW()
      WHERE user_id=$1
      RETURNING *
      `,
      [
        userId,
        mode ?? null,
        Number.isFinite(Number(slotMinutes)) ? Number(slotMinutes) : null,
        Number.isFinite(Number(bufferMinutes)) ? Number(bufferMinutes) : null,
        Number.isFinite(Number(maxBookingsPerDay)) ? Number(maxBookingsPerDay) : null,
        meetingLink ?? null,
        defaultLocation ?? null,
        appointmentTypes ? JSON.stringify(appointmentTypes) : null,
        notesToClients ?? null,
      ]
    );

    if (daySchedules) await saveDaySchedules(userId, daySchedules);

    const daySchedulesOut = await getDaySchedules(userId);
    const row = updated.rows[0] || {};

    return res.json({
      availability: {
        mode: row.mode ?? "Hybrid",
        slotMinutes: row.slot_minutes ?? 30,
        bufferMinutes: row.buffer_minutes ?? 10,
        maxBookingsPerDay: row.max_bookings_per_day ?? 8,
        meetingLink: row.meeting_link ?? "",
        defaultLocation: row.default_location ?? "",
        appointmentTypes: row.appointment_types ?? {},
        notesToClients: row.notes_to_clients ?? "",
        daySchedules: daySchedulesOut,
      },
    });
  } catch (e) {
    console.error("putAvailability error:", e);
    return res.status(500).json({ error: "Server error saving availability" });
  }
}

/**
 * -------- Work + Education (unchanged) ----------
 */

export async function addWork(req, res) {
  try {
    const userId = req.user.id;
    const { org, role, from, to, location, highlights } = req.body || {};
    if (!org || !role) return res.status(400).json({ error: "org and role are required" });

    const r = await pool.query(
      `
      INSERT INTO advocate_work_history (user_id, org, role, from_year, to_year, location, highlights)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::text[],'{}'))
      RETURNING *
      `,
      [userId, org, role, from ?? null, to ?? null, location ?? null, Array.isArray(highlights) ? highlights : []]
    );

    return res.json({ work: r.rows[0] });
  } catch (e) {
    console.error("addWork error:", e);
    return res.status(500).json({ error: "Server error adding work history" });
  }
}

export async function deleteWork(req, res) {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM advocate_work_history WHERE id=$1 AND user_id=$2`, [id, userId]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteWork error:", e);
    return res.status(500).json({ error: "Server error deleting work history" });
  }
}

export async function addEducation(req, res) {
  try {
    const userId = req.user.id;
    const { Degree, institute, year } = req.body || {};
    if (!Degree || !institute) return res.status(400).json({ error: "Degree and institute are required" });

    const r = await pool.query(
      `
      INSERT INTO advocate_education (user_id, Degree, institute, year)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [userId, Degree, institute, year ?? null]
    );

    return res.json({ education: r.rows[0] });
  } catch (e) {
    console.error("addEducation error:", e);
    return res.status(500).json({ error: "Server error adding education" });
  }
}

export async function deleteEducation(req, res) {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM advocate_education WHERE id=$1 AND user_id=$2`, [id, userId]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteEducation error:", e);
    return res.status(500).json({ error: "Server error deleting education" });
  }
}

/**
 * -------- Middleware (we will move next) ----------
 * Advocate cannot do case-intake / case-prep until verified
 */
export async function requireVerifiedAdvocate(req, res, next) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `
      SELECT ap.is_verified
      FROM advocate_profiles ap
      JOIN users u ON u.id = ap.user_id
      WHERE ap.user_id=$1 AND LOWER(u.role)='advocate'
      `,
      [userId]
    );

    const isVerified = !!r.rows[0]?.is_verified;
    if (!isVerified) return res.status(403).json({ error: "Advocate is not verified yet" });

    return next();
  } catch (e) {
    console.error("requireVerifiedAdvocate error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}

/**
 * POST /api/advocate/dashboard/profile/avatar
 * Upload/update the advocate's profile photo (stored under /uploads/avatars).
 */
export async function uploadAvatar(req, res) {
  try {
    if (!req.file?.filename) {
      return res.status(400).json({ error: "Avatar file is required" });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    await ensureProfileRow(req.user.id);
    await pool.query(
      `
      UPDATE advocate_profiles
      SET avatar_url = $1, updated_at = NOW()
      WHERE user_id = $2
      `,
      [avatarUrl, req.user.id]
    );

    return res.json({ message: "Avatar updated", avatarUrl });
  } catch (err) {
    console.error("uploadAvatar error:", err);
    return res.status(500).json({ error: err.message });
  }
}

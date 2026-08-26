import pool from "../../../../db.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/admin/clients?q=...
 * Returns: { clients: [...] }
 */
export async function listClients(req, res) {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();

    const where = q
      ? `WHERE UPPER(u.role)='CLIENT' AND (
           LOWER(u.email) LIKE $1
        OR LOWER(COALESCE(cp.full_name,'')) LIKE $1
        OR LOWER(COALESCE(cp.phone,'')) LIKE $1
      )`
      : `WHERE UPPER(u.role)='CLIENT'`;

    const values = q ? [`%${q}%`] : [];

    const r = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.role,
        u.created_at,
        cp.full_name AS name,
        cp.phone,
        cp.city
      FROM public.users u
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT 200
      `,
      values
    );

    return res.json({ clients: r.rows });
  } catch (err) {
    console.error("listClients error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/clients/:id
 * Returns: { client: {...} }
 */
export async function getClientFullProfile(req, res) {
  try {
    const id = toInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: "Invalid client id" });
    }

    const r = await pool.query(
      `
      SELECT
        u.id as user_id,
        u.email,
        u.role,
        u.created_at,

        cp.full_name AS name,
        cp.phone,
        cp.cnic,
        cp.city,
        cp.address,
        cp.location,
        cp.emergency_contact_name,
        cp.emergency_contact_phone,
        cp.avatar_url,
        cp.identity_doc_status,
        cp.address_proof_status

      FROM public.users u
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      WHERE u.id=$1 AND UPPER(u.role)='CLIENT'
      `,
      [id]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    return res.json({ client: r.rows[0] });
  } catch (err) {
    console.error("getClientFullProfile error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * PATCH /api/admin/clients/:id
 * Allows admin to update full client profile.
 * Works with CURRENT schema even if client_profiles.user_id is NOT unique.
 */
export async function updateClient(req, res) {
  const db = await pool.connect();
  try {
    const id = toInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: "Invalid client id" });
    }

    const body = req.body || {};

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;

    const cnic = typeof body.cnic === "string" ? body.cnic.trim() : undefined;
    const city = typeof body.city === "string" ? body.city.trim() : undefined;
    const address = typeof body.address === "string" ? body.address.trim() : undefined;
    const location = typeof body.location === "string" ? body.location.trim() : undefined;

    const emergency_contact_name =
      typeof body.emergency_contact_name === "string"
        ? body.emergency_contact_name.trim()
        : undefined;

    const emergency_contact_phone =
      typeof body.emergency_contact_phone === "string"
        ? body.emergency_contact_phone.trim()
        : undefined;

    const identity_doc_status =
      typeof body.identity_doc_status === "string"
        ? body.identity_doc_status.trim()
        : undefined;

    const address_proof_status =
      typeof body.address_proof_status === "string"
        ? body.address_proof_status.trim()
        : undefined;

    const avatar_url =
      typeof body.avatar_url === "string" ? body.avatar_url.trim() : undefined;

    const nothingToUpdate =
      email === undefined &&
      name === undefined &&
      phone === undefined &&
      cnic === undefined &&
      city === undefined &&
      address === undefined &&
      location === undefined &&
      emergency_contact_name === undefined &&
      emergency_contact_phone === undefined &&
      identity_doc_status === undefined &&
      address_proof_status === undefined &&
      avatar_url === undefined;

    if (nothingToUpdate) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    if (email !== undefined && email.length === 0) {
      return res.status(400).json({ error: "Email cannot be empty" });
    }

    await db.query("BEGIN");

    // Ensure CLIENT exists (prevents editing admins/staff)
    const userExists = await db.query(
      `SELECT id FROM public.users WHERE id=$1 AND UPPER(role)='CLIENT'`,
      [id]
    );
    if (userExists.rowCount === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Client not found" });
    }

    // Update email (handle unique conflict)
    if (email !== undefined) {
      try {
        await db.query(`UPDATE public.users SET email=$1 WHERE id=$2`, [email, id]);
      } catch (e) {
        // 23505 = unique_violation
        if (e?.code === "23505") {
          await db.query("ROLLBACK");
          return res.status(409).json({ error: "Email already in use" });
        }
        throw e;
      }
    }

    // Since client_profiles.user_id is NOT unique, use latest profile row
    const prof = await db.query(
      `SELECT id FROM public.client_profiles WHERE user_id=$1 ORDER BY id DESC LIMIT 1`,
      [id]
    );

    if (prof.rowCount === 0) {
      // Insert a new profile row
      await db.query(
        `
        INSERT INTO public.client_profiles (
          user_id, full_name, phone, cnic, city, address, location,
          emergency_contact_name, emergency_contact_phone,
          identity_doc_status, address_proof_status, avatar_url
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          id,
          name ?? null,
          phone ?? null,
          cnic ?? null,
          city ?? null,
          address ?? null,
          location ?? null,
          emergency_contact_name ?? null,
          emergency_contact_phone ?? null,
          identity_doc_status ?? null,
          address_proof_status ?? null,
          avatar_url ?? null,
        ]
      );
    } else {
      // Update latest profile row only
      const profileId = prof.rows[0].id;

      await db.query(
        `
        UPDATE public.client_profiles
        SET
          full_name = COALESCE($2, full_name),
          phone = COALESCE($3, phone),
          cnic = COALESCE($4, cnic),
          city = COALESCE($5, city),
          address = COALESCE($6, address),
          location = COALESCE($7, location),
          emergency_contact_name = COALESCE($8, emergency_contact_name),
          emergency_contact_phone = COALESCE($9, emergency_contact_phone),
          identity_doc_status = COALESCE($10, identity_doc_status),
          address_proof_status = COALESCE($11, address_proof_status),
          avatar_url = COALESCE($12, avatar_url)
        WHERE id=$1
        `,
        [
          profileId,
          name ?? null,
          phone ?? null,
          cnic ?? null,
          city ?? null,
          address ?? null,
          location ?? null,
          emergency_contact_name ?? null,
          emergency_contact_phone ?? null,
          identity_doc_status ?? null,
          address_proof_status ?? null,
          avatar_url ?? null,
        ]
      );
    }

    await db.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("updateClient error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    db.release();
  }
}

/**
 * DELETE /api/admin/clients/:id
 * Returns: { ok: true }
 */
export async function deleteClient(req, res) {
  const db = await pool.connect();
  try {
    const id = toInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: "Invalid client id" });
    }

    await db.query("BEGIN");

    // Ensure CLIENT exists (prevents deleting admins/staff)
    const userExists = await db.query(
      `SELECT id FROM public.users WHERE id=$1 AND UPPER(role)='CLIENT'`,
      [id]
    );
    if (userExists.rowCount === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Client not found" });
    }

    // delete profile rows first
    await db.query(`DELETE FROM public.client_profiles WHERE user_id=$1`, [id]);

    // delete user row (other tables should cascade if FK is ON DELETE CASCADE)
    const del = await db.query(`DELETE FROM public.users WHERE id=$1 RETURNING id`, [
      id,
    ]);

    if (del.rowCount === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Client not found" });
    }

    await db.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("deleteClient error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    db.release();
  }
}

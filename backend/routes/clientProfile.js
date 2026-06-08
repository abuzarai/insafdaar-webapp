// import express from "express";
// import pool from "../db.js";
// import { authMiddleware } from "../middleware/authMiddleware.js";
// import { isValidPakCnic, isValidPakPhone } from "../utils/validators.js";

// const router = express.Router();

// router.get("/profile", authMiddleware, async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const userRes = await pool.query(
//       "SELECT id, name, email, role, created_at FROM users WHERE id=$1",
//       [userId]
//     );
//     if (userRes.rows.length === 0)
//       return res.status(404).json({ error: "User not found" });
//     if (userRes.rows[0].role !== "client")
//       return res.status(403).json({ error: "Client only" });

//     const profRes = await pool.query(
//       "SELECT * FROM client_profiles WHERE user_id=$1",
//       [userId]
//     );
//     const profileRow = profRes.rows[0];

//     return res.json({
//       profile: {
//         fullName: userRes.rows[0].name || "",
//         email: userRes.rows[0].email || "",
//         joined: userRes.rows[0].created_at || "",

//         phone: profileRow?.phone || "",
//         cnic: profileRow?.cnic || "",
//         city: profileRow?.city || "",
//         address: profileRow?.address || "",
//         location: profileRow?.location || "",

//         emergencyContactName: profileRow?.emergency_contact_name || "",
//         emergencyContactPhone: profileRow?.emergency_contact_phone || "",

//         avatarUrl: profileRow?.avatar_url || "",

//         identityDocStatus: profileRow?.identity_doc_status || "INCOMPLETE",
//         addressProofStatus: profileRow?.address_proof_status || "INCOMPLETE",

//         // ✅ STEP 4: add this
//         documentsCompleted: profileRow?.documents_completed || false,
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// router.put("/profile", authMiddleware, async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const p = req.body?.profile;
//     if (!p) return res.status(400).json({ error: "profile object required" });

//     if (!isValidPakCnic(p.cnic))
//       return res
//         .status(400)
//         .json({ error: "Invalid CNIC format. Use 12345-1234567-1" });

//     if (!isValidPakPhone(p.phone))
//       return res
//         .status(400)
//         .json({ error: "Invalid phone. Use 03XXXXXXXXX (11 digits)" });

//     if (p.emergencyContactPhone && !isValidPakPhone(p.emergencyContactPhone))
//       return res
//         .status(400)
//         .json({ error: "Invalid emergency phone. Use 03XXXXXXXXX" });

//     // update name in users table
//     if (p.fullName && String(p.fullName).trim()) {
//       await pool.query("UPDATE users SET name=$1 WHERE id=$2", [
//         p.fullName.trim(),
//         userId,
//       ]);
//     }

//     await pool.query(
//       `
//       INSERT INTO client_profiles
//         (user_id, phone, cnic, city, address, location,
//          emergency_contact_name, emergency_contact_phone, avatar_url,
//          identity_doc_status, address_proof_status, updated_at)
//       VALUES
//         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
//       ON CONFLICT (user_id)
//       DO UPDATE SET
//         phone = EXCLUDED.phone,
//         cnic = EXCLUDED.cnic,
//         city = EXCLUDED.city,
//         address = EXCLUDED.address,
//         location = EXCLUDED.location,
//         emergency_contact_name = EXCLUDED.emergency_contact_name,
//         emergency_contact_phone = EXCLUDED.emergency_contact_phone,
//         avatar_url = EXCLUDED.avatar_url,
//         identity_doc_status = EXCLUDED.identity_doc_status,
//         address_proof_status = EXCLUDED.address_proof_status,
//         updated_at = NOW()
//       `,
//       [
//         userId,
//         (p.phone || "").trim(),
//         (p.cnic || "").trim(),
//         (p.city || "").trim(),
//         (p.address || "").trim(),
//         (p.location || "").trim(),
//         (p.emergencyContactName || "").trim(),
//         (p.emergencyContactPhone || "").trim(),
//         (p.avatarUrl || "").trim(),
//         p.identityDocStatus || "INCOMPLETE",
//         p.addressProofStatus || "INCOMPLETE",
//       ]
//     );

//     res.json({ message: "Profile saved" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// export default router;


import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { isValidPakCnic, isValidPakPhone } from "../utils/validators.js";

const router = express.Router();

// GET /profile - Fetch client profile
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get basic user info
    const userRes = await pool.query(
      "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (userRes.rows[0].role !== "client") {
      return res.status(403).json({ error: "Access restricted to clients only" });
    }

    // Get extended profile
    const profRes = await pool.query(
      "SELECT * FROM client_profiles WHERE user_id = $1",
      [userId]
    );

    const profileRow = profRes.rows[0] || {};

    return res.json({
      success: true,
      profile: {
        fullName: userRes.rows[0].name || "",
        email: userRes.rows[0].email || "",
        joined: userRes.rows[0].created_at
          ? new Date(userRes.rows[0].created_at).toISOString().split("T")[0]
          : "",

        phone: profileRow.phone || "",
        cnic: profileRow.cnic || "",
        city: profileRow.city || "",
        address: profileRow.address || "",
        location: profileRow.location || "",

        emergencyContactName: profileRow.emergency_contact_name || "",
        emergencyContactPhone: profileRow.emergency_contact_phone || "",

        avatarUrl: profileRow.avatar_url || "",

        identityDocStatus: profileRow.identity_doc_status || "INCOMPLETE",
        addressProofStatus: profileRow.address_proof_status || "INCOMPLETE",
        documentsCompleted: profileRow.documents_completed || false,
      },
    });
  } catch (err) {
    console.error("GET /profile error:", err);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

// PUT /profile - Update client profile
router.put("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const p = req.body?.profile;

    if (!p || typeof p !== "object") {
      return res.status(400).json({ error: "Invalid request: 'profile' object is required" });
    }

    // ── Validation ────────────────────────────────────────────────
    if (p.cnic && !isValidPakCnic(p.cnic)) {
      return res.status(400).json({
        error: "Invalid CNIC format. Use 12345-1234567-1 or 1234512345671",
      });
    }

    if (p.phone && !isValidPakPhone(p.phone)) {
      return res.status(400).json({
        error: "Invalid phone number. Use 03XXXXXXXXX format (11 digits)",
      });
    }

    if (p.emergencyContactPhone && !isValidPakPhone(p.emergencyContactPhone)) {
      return res.status(400).json({
        error: "Invalid emergency contact phone. Use 03XXXXXXXXX format",
      });
    }

    // ── Update name in users table (if provided) ──────────────────
    if (p.fullName?.trim()) {
      await pool.query("UPDATE users SET name = $1 WHERE id = $2", [
        p.fullName.trim(),
        userId,
      ]);
    }

    // ── Prepare values for upsert (use empty string for missing fields) ──
    const values = [
      userId,
      (p.phone || "").trim(),
      (p.cnic || "").trim(),
      (p.city || "").trim(),
      (p.address || "").trim(),
      (p.location || "").trim(),
      (p.emergencyContactName || "").trim(),
      (p.emergencyContactPhone || "").trim(),
      (p.avatarUrl || "").trim(),
      p.identityDocStatus || "INCOMPLETE",
      p.addressProofStatus || "INCOMPLETE",
    ];

    // ── Upsert into client_profiles ───────────────────────────────
    await pool.query(
      `
      INSERT INTO client_profiles (
        user_id, phone, cnic, city, address, location,
        emergency_contact_name, emergency_contact_phone, avatar_url,
        identity_doc_status, address_proof_status, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        phone = EXCLUDED.phone,
        cnic = EXCLUDED.cnic,
        city = EXCLUDED.city,
        address = EXCLUDED.address,
        location = EXCLUDED.location,
        emergency_contact_name = EXCLUDED.emergency_contact_name,
        emergency_contact_phone = EXCLUDED.emergency_contact_phone,
        avatar_url = EXCLUDED.avatar_url,
        identity_doc_status = EXCLUDED.identity_doc_status,
        address_proof_status = EXCLUDED.address_proof_status,
        updated_at = NOW()
      RETURNING *
      `,
      values
    );

    return res.json({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (err) {
    console.error("PUT /profile error:", err);
    return res.status(500).json({ error: "Failed to update profile" });
  }
});


export default router;
import express from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { generateOtp, hashOtp } from "../utils/otp.js";
import { sendOtpEmail } from "../utils/mailer.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const db = await pool.connect();
  try {
    const { name, email, password, cnic, phone } = req.body;

    // basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Required fields missing." });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).toLowerCase().trim();

    if (!cleanName) return res.status(400).json({ error: "Name is required." });
    if (!cleanEmail) return res.status(400).json({ error: "Email is required." });

    await db.query("BEGIN");

    // check if user already exists
    const exists = await db.query("SELECT id FROM users WHERE email=$1", [cleanEmail]);
    if (exists.rows.length > 0) {
      await db.query("ROLLBACK");
      return res.status(400).json({ error: "User already exists." });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // create user (email NOT verified yet)
    const userResult = await db.query(
      `INSERT INTO users (name, email, password, role, email_verified)
       VALUES ($1,$2,$3,$4,false)
       RETURNING id, email`,
      [cleanName, cleanEmail, hashedPassword, "client"]
    );

    const userId = userResult.rows[0].id;

    // ✅ create client profile row so Admin Dashboard can show name
    // (no ON CONFLICT because user_id is not unique/PK in your table)
    const profileExists = await db.query(
      "SELECT 1 FROM public.client_profiles WHERE user_id=$1 LIMIT 1",
      [userId]
    );

    if (profileExists.rowCount === 0) {
      await db.query(
        `INSERT INTO public.client_profiles (user_id, full_name, phone)
         VALUES ($1,$2,$3)`,
        [userId, cleanName, phone || null]
      );
    } else {
      // optional: if profile exists, keep it updated
      await db.query(
        `UPDATE public.client_profiles
         SET full_name = COALESCE(NULLIF($2,''), full_name),
             phone     = COALESCE(NULLIF($3,''), phone)
         WHERE user_id=$1`,
        [userId, cleanName, phone || null]
      );
    }

    // insert client details (table should already exist)
    await db.query(
      "INSERT INTO client_details (user_id, cnic, phone) VALUES ($1,$2,$3)",
      [userId, cnic || null, phone || null]
    );

    // ===== OTP LOGIC =====
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    await db.query(
      `INSERT INTO email_otps (user_id, otp_hash, expires_at)
       VALUES ($1,$2, NOW() + INTERVAL '10 minutes')`,
      [userId, otpHash]
    );

    await db.query("COMMIT");

    // send OTP email (after commit)
    await sendOtpEmail(cleanEmail, otp);

    return res.status(201).json({
      message: "OTP sent to email",
      redirect: "/verify-otp",
      email: cleanEmail,
    });
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch {}
    console.error("Client register error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    db.release();
  }
});

export default router;

import express from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { generateOtp, hashOtp } from "../utils/otp.js";
import { sendOtpEmail } from "../utils/mailer.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { name, email, password, bar_id, specialization, experience } = req.body;

    // basic validation
    if (!name || !email || !password || !bar_id) {
      return res.status(400).json({ error: "Required fields missing." });
    }

    // check existing user
    const exists = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: "User already exists." });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // create user (NOT verified yet)
    const userResult = await pool.query(
      `INSERT INTO users (name, email, password, role, email_verified)
       VALUES ($1,$2,$3,$4,false)
       RETURNING id, email`,
      [name, email.toLowerCase(), hashedPassword, "advocate"]
    );

    const userId = userResult.rows[0].id;

    // advocate details (TABLE SHOULD EXIST – will fix later via migration)
    await pool.query(
      "INSERT INTO advocate_details (user_id, bar_id, specialization, experience) VALUES ($1,$2,$3,$4)",
      [userId, bar_id, specialization, experience]
    );

    // ===== OTP LOGIC =====
    // Rate-limit issuance: one OTP per minute per user.
    const recent = await pool.query(
      `SELECT 1 FROM email_otps WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 minute' LIMIT 1`,
      [userId]
    );
    if (recent.rows.length > 0) {
      return res.status(429).json({ error: "OTP already sent recently. Please wait a minute before resending." });
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    await pool.query(
      `INSERT INTO email_otps (user_id, otp_hash, expires_at)
       VALUES ($1,$2, NOW() + INTERVAL '10 minutes')`,
      [userId, otpHash]
    );

    // send OTP email
    await sendOtpEmail(email, otp);

    // response for frontend redirect
    return res.status(201).json({
      message: "OTP sent to email",
      redirect: "/verify-otp",
      email: email
    });

  } catch (err) {
    console.error("Advocate register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

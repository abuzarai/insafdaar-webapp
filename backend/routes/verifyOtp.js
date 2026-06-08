import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";

const router = express.Router();

/**
 * POST /api/auth/verify-otp
 * body: { email, otp }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    // find user
    const userRes = await pool.query("SELECT id, email_verified FROM users WHERE email=$1", [
      email.toLowerCase(),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userRes.rows[0];

    if (user.email_verified) {
      return res.json({ message: "Email already verified ✅" });
    }

    // get latest OTP (not expired, not used)
    const otpRes = await pool.query(
      `SELECT id, otp_hash, expires_at, used
       FROM email_otps
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ error: "OTP not found. Please request a new OTP." });
    }

    const otpRow = otpRes.rows[0];

    if (otpRow.used) {
      return res.status(400).json({ error: "OTP already used. Please request a new OTP." });
    }

    if (new Date(otpRow.expires_at) < new Date()) {
      return res.status(400).json({ error: "OTP expired. Please request a new OTP." });
    }

    // compare OTP
    const isMatch = await bcrypt.compare(String(otp), otpRow.otp_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // mark verified + mark otp used
    await pool.query("UPDATE users SET email_verified=true WHERE id=$1", [user.id]);
    await pool.query("UPDATE email_otps SET used=true WHERE id=$1", [otpRow.id]);

    return res.json({ message: "Email verified successfully ✅" });
  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;

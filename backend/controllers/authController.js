import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import dotenv from "dotenv";

dotenv.config();

// LOGIN
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const userResult = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid email or password" });

    // JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PROFILE (protected route example)
export const getProfile = async (req, res) => {
  try {
    const user = await pool.query("SELECT id, name, email, role FROM users WHERE id=$1", [
      req.user.id,
    ]);
    res.json(user.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

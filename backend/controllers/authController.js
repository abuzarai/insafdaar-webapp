// // backend/controllers/authController.js
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import pool from "../db.js";
// import dotenv from "dotenv";

// dotenv.config();

// // REGISTER
// export const registerUser = async (req, res) => {
//   try {
//     const { name, email, password, role } = req.body;

//     // Check if user exists
//     const existing = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
//     if (existing.rows.length > 0) {
//       return res.status(400).json({ error: "User already exists" });
//     }

//     // Hash password
//     const hashedPassword = await bcrypt.hash(password, 10);

//     // Insert user
//     const newUser = await pool.query(
//       "INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role",
//       [name, email, hashedPassword, role || "client"]
//     );

//     res.status(201).json({ message: "User registered successfully", user: newUser.rows[0] });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// // LOGIN
// export const loginUser = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     const userResult = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
//     if (userResult.rows.length === 0) {
//       return res.status(400).json({ error: "Invalid email or password" });
//     }

//     const user = userResult.rows[0];
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) return res.status(400).json({ error: "Invalid email or password" });

//     // JWT token
//     const token = jwt.sign(
//       { id: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "8h" }
//     );

//     res.json({
//       message: "Login successful",
//       token,
//       user: { id: user.id, name: user.name, email: user.email, role: user.role },
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// // PROFILE (protected route example)
// export const getProfile = async (req, res) => {
//   try {
//     const user = await pool.query("SELECT id, name, email, role FROM users WHERE id=$1", [
//       req.user.id,
//     ]);
//     res.json(user.rows[0]);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


// backend/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import dotenv from "dotenv";
import { sendNotificationEmail } from "../utils/mailer.js";      // ✅ ADDED
import { notifyAllAdmins } from "../utils/notify.js";            // ✅ ADDED

dotenv.config();

// REGISTER
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Check if user exists
    const existing = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const newUser = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role",
      [name, email, hashedPassword, role || "client"]
    );

    // ✅ ADDED: Admin in-app notification (dashboard)
    try {
      const u = newUser.rows[0];
      await notifyAllAdmins({
        title: "New user registered",
        message: `A new user registered.\nName: ${u.name}\nEmail: ${u.email}\nRole: ${u.role}\nUser ID: ${u.id}`,
        type: "AUTH",
      });
    } catch (notifyErr) {
      console.error("Admin dashboard notification failed:", notifyErr);
      // do NOT fail registration
    }

    // ✅ ADDED: Admin email notification (fallback email)
    const adminEmail = process.env.ADMIN_EMAIL;
    try {
      const u = newUser.rows[0];
      await sendNotificationEmail({
        to: adminEmail,
        subject: "New user registered",
        title: "New User Registered",
        message: `
          <p>A new user has registered.</p>
          <ul>
            <li><b>User ID:</b> ${u.id}</li>
            <li><b>Name:</b> ${u.name}</li>
            <li><b>Email:</b> ${u.email}</li>
            <li><b>Role:</b> ${u.role}</li>
          </ul>
        `,
      });
    } catch (mailErr) {
      console.error("Admin email failed:", mailErr);
      // do NOT fail registration
    }

    res.status(201).json({ message: "User registered successfully", user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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

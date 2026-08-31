import express from "express";
import multer from "multer";
import path from "path";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { randomFileName } from "../utils/randomFileName.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/avatars"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomFileName(ext));
  },
});

function fileFilter(req, file, cb) {
  const ok = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Only png/jpg/webp allowed"), ok);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

router.post("/avatar", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // upsert profile row
    await pool.query(
      `
      INSERT INTO client_profiles (user_id, avatar_url)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
      `,
      [req.user.id, avatarUrl]
    );

    res.json({ message: "Avatar updated", avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

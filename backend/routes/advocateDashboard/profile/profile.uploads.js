import multer from "multer";
import path from "path";
import fs from "fs";
import { randomFileName } from "../../../utils/randomFileName.js";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "advocate", "documents");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".pdf"].includes(ext) ? ext : ".bin";
    cb(null, randomFileName(safeExt));
  },
});

function fileFilter(req, file, cb) {
  const allowedMime = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
  const allowedExt = [".png", ".jpg", ".jpeg", ".pdf"];
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (!allowedMime.includes(file.mimetype) || !allowedExt.includes(ext)) {
    return cb(new Error("Only PNG, JPG, JPEG, or PDF files are allowed"), false);
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/avatars"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".jpg";
    cb(null, randomFileName(safeExt));
  },
});

function avatarFileFilter(req, file, cb) {
  const ok = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Only PNG, JPG, or WEBP images are allowed"), ok);
}

export const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.resolve("uploads/billing-proofs");

// ✅ ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();

    // ✅ allow only safe extensions
    const safeExt = [".png", ".jpg", ".jpeg", ".pdf"].includes(ext)
      ? ext
      : ".bin";

    cb(null, `payment_proof_${req.user.id}_${Date.now()}${safeExt}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/pdf",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Only PNG, JPG, JPEG, or PDF files are allowed."), false);
  }

  cb(null, true);
}

export const proofUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

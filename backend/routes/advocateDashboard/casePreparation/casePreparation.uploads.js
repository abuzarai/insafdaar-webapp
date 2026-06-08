import multer from "multer";
import path from "path";
import fs from "fs";

const DOC_DIR = path.resolve("uploads/case-documents");
fs.mkdirSync(DOC_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOC_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    cb(null, `adv_case_doc_${req.user.id}_${Date.now()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);

  if (!allowed.has(file.mimetype)) {
    return cb(new Error("Only PNG/JPG/WEBP, PDF, DOC, and DOCX files are allowed."), false);
  }

  return cb(null, true);
}

export const advocateCaseDocumentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

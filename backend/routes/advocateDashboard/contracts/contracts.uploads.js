import multer from "multer";
import path from "path";
import fs from "fs";
import { randomFileName } from "../../../utils/randomFileName.js";

const CONTRACT_ATTACHMENTS_DIR = path.join(process.cwd(), "uploads", "contracts");

if (!fs.existsSync(CONTRACT_ATTACHMENTS_DIR)) {
  fs.mkdirSync(CONTRACT_ATTACHMENTS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONTRACT_ATTACHMENTS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".pdf", ".docx"].includes(ext) ? ext : ".bin";
    cb(null, randomFileName(safeExt));
  },
});

function fileFilter(req, file, cb) {
  const allowedMime = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const allowedExt = [".pdf", ".docx"];
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (!allowedMime.includes(file.mimetype) || !allowedExt.includes(ext)) {
    return cb(new Error("Only PDF and DOCX files are allowed"), false);
  }
  cb(null, true);
}

export const contractAttachmentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

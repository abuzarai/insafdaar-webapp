import multer from "multer";
import path from "path";
import fs from "fs";
import { randomFileName } from "../../../utils/randomFileName.js";

const VOICE_DIR = path.resolve("uploads/case-audio");
const DOC_DIR = path.resolve("uploads/case-documents");

fs.mkdirSync(VOICE_DIR, { recursive: true });
fs.mkdirSync(DOC_DIR, { recursive: true });

const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VOICE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".webm").toLowerCase();
    cb(null, randomFileName(ext || ".webm"));
  },
});

export const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOC_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomFileName(ext));
  },
});

export const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

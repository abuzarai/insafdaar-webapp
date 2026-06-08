import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  getActiveStartCase,
  createDraftCase,
  startAiInterviewSession,
  uploadOtherLanguageVoice,
  uploadCaseDocument,
  listCaseDocuments,
  listCaseVoiceNotes,
  getCaseMatchingForClient,
  selectPreferredAdvocate,
  markInterviewCompleteForCase,
} from "../../../controllers/clientDashboard/startCase/startCase.controller.js";

import { voiceUpload, docUpload } from "./startCase.uploads.js";

const router = express.Router();

// /api/client/dashboard/start-case/...
router.get("/active", authMiddleware, getActiveStartCase);
router.post("/draft", authMiddleware, createDraftCase);
router.post("/ai/start", authMiddleware, startAiInterviewSession);

router.post(
  "/voice/upload",
  authMiddleware,
  voiceUpload.single("audio"),
  uploadOtherLanguageVoice
);

router.post(
  "/documents/upload",
  authMiddleware,
  docUpload.single("file"),
  uploadCaseDocument
);

// ✅ NEW: lists for frontend UI
router.get("/documents", authMiddleware, listCaseDocuments);
router.get("/voice", authMiddleware, listCaseVoiceNotes);
router.get("/matching", authMiddleware, getCaseMatchingForClient);
router.post("/matching/select", authMiddleware, selectPreferredAdvocate);
router.post("/interview/complete", authMiddleware, markInterviewCompleteForCase);

export default router;

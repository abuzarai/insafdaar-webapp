import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";
import {
  getCaseContractForAdvocate,
  upsertCaseContractByAdvocate,
  uploadCaseContractAttachmentByAdvocate,
  requestContractSigningOtpByAdvocate,
  verifyContractSigningOtpByAdvocate,
  signCaseContractByAdvocate,
  getLatestContractAIDraftByAdvocate,
  generateContractAIDraftByAdvocate,
  regenerateContractAIDraftSectionByAdvocate,
  saveContractAIDraftByAdvocate,
  exportContractAIDraftDocxByAdvocate,
  exportContractAIDraftPdfByAdvocate,
} from "../../../controllers/advocateDashboard/contracts/contracts.controller.js";
import { contractAttachmentUpload } from "./contracts.uploads.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/cases/:caseId", getCaseContractForAdvocate);
router.put("/cases/:caseId", upsertCaseContractByAdvocate);
router.post(
  "/cases/:caseId/attachments",
  contractAttachmentUpload.single("attachment"),
  uploadCaseContractAttachmentByAdvocate
);
router.post("/cases/:caseId/sign/request-otp", requestContractSigningOtpByAdvocate);
router.post("/cases/:caseId/sign/verify-otp", verifyContractSigningOtpByAdvocate);
router.post("/cases/:caseId/sign", signCaseContractByAdvocate);
router.get("/cases/:caseId/ai-draft/latest", getLatestContractAIDraftByAdvocate);
router.post("/cases/:caseId/ai-draft/generate", generateContractAIDraftByAdvocate);
router.post("/cases/:caseId/ai-draft/regenerate-section", regenerateContractAIDraftSectionByAdvocate);
router.post("/cases/:caseId/ai-draft/save", saveContractAIDraftByAdvocate);
router.post("/cases/:caseId/ai-draft/export/docx", exportContractAIDraftDocxByAdvocate);
router.post("/cases/:caseId/ai-draft/export/pdf", exportContractAIDraftPdfByAdvocate);

export default router;

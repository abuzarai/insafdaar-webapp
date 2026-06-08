import { Router } from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  listAcceptedCasesForAdvocate,
  getCasePreparationDetails,
  updatePreparationDocumentStatus,
  updatePreparationItem,
  requestMissingDocsEmail,
  uploadPreparationCaseDocument,
  generatePreparationAIDraft,
  regeneratePreparationAIDraftSection,
  savePreparationAIDraft,
  exportPreparationAIDraftDocx,
  exportPreparationAIDraftPdf,
  getPreparationLatestAIDraft,
  markPreparationComplete,
} from "../../../controllers/advocateDashboard/casePreparation/casePreparation.controller.js";
import { advocateCaseDocumentUpload } from "./casePreparation.uploads.js";

const router = Router();

/**
 * All routes below are PROTECTED
 * Advocate must be logged in
 */
router.use(authMiddleware);

/**
 * GET
 * List advocate accepted cases (for filter dropdown)
 * /api/advocate/dashboard/case-preparation/cases/accepted
 */
router.get("/cases/accepted", listAcceptedCasesForAdvocate);

/**
 * GET
 * Full case preparation details
 * /api/advocate/dashboard/case-preparation/:caseId
 */
router.get("/:caseId", getCasePreparationDetails);

/**
 * PATCH
 * Update case/client document verification status
 * Body:
 *  - status (string)
 *  - source?: "case" | "client" (default: "case")
 *
 * /api/advocate/dashboard/case-preparation/:caseId/documents/:documentId/status
 */
router.patch("/:caseId/documents/:documentId/status", updatePreparationDocumentStatus);

/**
 * PATCH
 * Tick / untick checklist item
 * Body:
 *  - doc_key (string)
 *  - is_provided (boolean)
 *  - provided_doc_id (optional)
 *
 * /api/advocate/dashboard/case-preparation/:caseId/items
 */
router.patch("/:caseId/items", updatePreparationItem);

/**
 * POST
 * Request missing documents from client (email + log)
 * Body:
 *  - missing_doc_keys: string[]
 *  - message?: string
 *
 * /api/advocate/dashboard/case-preparation/:caseId/request-docs
 */
router.post("/:caseId/request-docs", requestMissingDocsEmail);

/**
 * POST
 * Generate AI draft template from drafting assistant
 * Body:
 *  - document_type (required)
 *  - advocate_notes? (string)
 *  - language? (string, default English)
 *
 * /api/advocate/dashboard/case-preparation/:caseId/ai-draft/generate
 */
router.post("/:caseId/ai-draft/generate", generatePreparationAIDraft);
router.post("/:caseId/ai-draft/regenerate-section", regeneratePreparationAIDraftSection);
router.post("/:caseId/ai-draft/save", savePreparationAIDraft);
router.post("/:caseId/ai-draft/export/docx", exportPreparationAIDraftDocx);
router.post("/:caseId/ai-draft/export/pdf", exportPreparationAIDraftPdf);
router.get("/:caseId/ai-draft/latest", getPreparationLatestAIDraft);

/**
 * POST
 * Upload case document from preparation quick actions
 * Body (multipart/form-data):
 *  - file (required)
 *  - docType? (string)
 *  - note? (string)
 *
 * /api/advocate/dashboard/case-preparation/:caseId/documents/upload
 */
router.post("/:caseId/documents/upload", advocateCaseDocumentUpload.single("file"), uploadPreparationCaseDocument);

/**
 * PATCH
 * Mark preparation completed
 * /api/advocate/dashboard/case-preparation/:caseId/complete
 */
router.patch("/:caseId/complete", markPreparationComplete);

export default router;

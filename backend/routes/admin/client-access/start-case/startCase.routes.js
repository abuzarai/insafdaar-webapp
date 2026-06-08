import express from "express";
import {
  adminGetClientActiveStartCase,
  adminGetCaseDocuments,
  adminGetCaseVoiceNotes,
  adminListAssignmentQueue,
  adminRunCaseMatching,
  adminListCaseMatchCandidates,
  adminAssignAdvocateToCase,
} from "../../../../controllers/admin/client-access/start-case/startCase.admin.controller.js";



const router = express.Router();

/**
 * Admin views client active case (latest DRAFT/INTAKE_STARTED)
 * GET /api/admin/client-access/start-case/active?userId=123
 */
router.get("/active", adminGetClientActiveStartCase);

/**
 * Admin views case documents
 * GET /api/admin/client-access/start-case/documents?caseId=123
 */
router.get("/documents", adminGetCaseDocuments);

/**
 * Admin views case voice notes
 * GET /api/admin/client-access/start-case/voice?caseId=123
 */
router.get("/voice", adminGetCaseVoiceNotes);
router.get("/assignment-queue", adminListAssignmentQueue);

/**
 * Admin runs advocate matching and reads shortlisted candidates
 * POST /api/admin/client-access/start-case/matching/run
 * GET  /api/admin/client-access/start-case/matching/candidates?caseId=123
 */
router.post("/matching/run", adminRunCaseMatching);
router.get("/matching/candidates", adminListCaseMatchCandidates);

/**
 * Admin assigns advocate
 * POST /api/admin/client-access/start-case/assign-advocate
 * body: { caseId, advocateId }
 */
router.post("/assign-advocate", adminAssignAdvocateToCase);

export default router;

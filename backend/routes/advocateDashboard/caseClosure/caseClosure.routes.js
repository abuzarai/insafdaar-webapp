import { Router } from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";
import {
  getClosableCases,
  getCaseClosureReport,
  upsertCaseClosureReport,
} from "../../../controllers/advocateDashboard/caseClosure/caseClosure.controller.js";

const router = Router();

/**
 * List cases assigned to this advocate (for selector)
 * GET /api/advocate/dashboard/case-closure/cases
 */
router.get("/case-closure/cases", authMiddleware, getClosableCases);

/**
 * Get existing closure report (if already submitted)
 * GET /api/advocate/dashboard/case-closure/cases/:caseId
 */
router.get("/case-closure/cases/:caseId", authMiddleware, getCaseClosureReport);

/**
 * Create/Update closure report
 * POST /api/advocate/dashboard/case-closure/cases/:caseId
 */
router.post("/case-closure/cases/:caseId", authMiddleware, upsertCaseClosureReport);

export default router;

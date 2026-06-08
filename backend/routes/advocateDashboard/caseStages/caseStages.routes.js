import { Router } from "express";

import { authMiddleware } from "../../../middleware/authMiddleware.js";
import {
  getCaseStages,
  completeCaseStage,
} from "../../../controllers/advocateDashboard/caseStages/caseStages.controller.js";

const router = Router();

/**
 * GET all stages + progress for a case
 * 
 */
router.get("/cases/:caseId/stages", authMiddleware, getCaseStages);

/**
 * Mark a stage as completed
 */
router.post("/cases/:caseId/stages/complete", authMiddleware, completeCaseStage);

export default router;

import express from "express";
import {
  getAssignedCases,
  getCaseDetails,
  getCaseFull,
  getCaseVouchers,
  acceptCase,
  rejectCase,
} from "../../../controllers/advocateDashboard/cases/cases.controller.js";

import { authMiddleware } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// Protect all advocate routes
router.use(authMiddleware);

router.get("/assigned", getAssignedCases);
router.get("/:caseId/full", getCaseFull);   // ✅ NEW
router.get("/:caseId/vouchers", getCaseVouchers);
router.get("/:caseId", getCaseDetails);
router.post("/:caseId/accept", acceptCase);
router.post("/:caseId/reject", rejectCase);

export default router;

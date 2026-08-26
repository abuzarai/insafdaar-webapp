import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  caseDetailsAccess,
  getCaseDetails,
} from "../../../controllers/clientDashboard/caseDetails/caseDetails.controller.js";

const router = express.Router();

// ✅ ACCESS CHECK (lock/unlock)
router.get("/access", authMiddleware, caseDetailsAccess);

// ✅ DETAILS (only after unlock)
router.get("/details", authMiddleware, getCaseDetails);

export default router;

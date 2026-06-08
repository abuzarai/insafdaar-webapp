import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  createFeedback,
  getMyFeedback,
  getAdvocateFeedbackSummary,
} from "../../../controllers/clientDashboard/feedback/feedback.controller.js";

const router = express.Router();

// /api/client/dashboard/feedback/...
router.post("/", authMiddleware, createFeedback);
router.get("/mine", authMiddleware, getMyFeedback);

// used later for advocate public profile cards (still protected for now)
router.get("/advocate/:advocateUserId/summary", authMiddleware, getAdvocateFeedbackSummary);

export default router;

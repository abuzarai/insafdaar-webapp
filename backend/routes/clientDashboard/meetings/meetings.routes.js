import { Router } from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";
import { listMyApprovedMeetings } from "../../../controllers/clientDashboard/meetings/approvedMeetings.controller.js";

const router = Router();

// GET /api/client/dashboard/meetings/approved
router.get("/approved", authMiddleware, listMyApprovedMeetings);

export default router;

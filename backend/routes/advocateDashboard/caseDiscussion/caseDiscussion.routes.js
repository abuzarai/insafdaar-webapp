import express from "express";
import {
  requestMeeting,
  listMyMeetings,
} from "../../../controllers/advocateDashboard/caseDiscussion/caseDiscussion.controller.js";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// ✅ GET approved meetings list (default APPROVED)
router.get("/meetings", authMiddleware, listMyMeetings);

// ✅ POST request meeting
router.post("/:caseId/request-meeting", authMiddleware, requestMeeting);

export default router;

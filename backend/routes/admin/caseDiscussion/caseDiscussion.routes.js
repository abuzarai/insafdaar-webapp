import express from "express";
import {
  adminListMeetingRequests,
  adminApproveMeetingRequest,
  adminRejectMeetingRequest,
} from "../../../controllers/admin/caseDiscussion/caseDiscussion.admin.controller.js";

const router = express.Router();

router.get("/meeting-requests", adminListMeetingRequests);
router.patch("/meeting-requests/:meetingId/approve", adminApproveMeetingRequest);
router.patch("/meeting-requests/:meetingId/reject", adminRejectMeetingRequest);

export default router;

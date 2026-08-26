import { Router } from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  listMyCasesForHearings,
  listCaseHearings,
  createHearing,
  updateHearingStatusAndLogs,
  upsertAttendance,
  upsertProceedings,
  addEvidence,
  listEvidence,
  addDraft,
  listDrafts,
} from "../../../controllers/advocateDashboard/caseHearing/caseHearing.controller.js";

const router = Router();

/**
 * All routes below are PROTECTED
 * Advocate must be logged in
 */
router.use(authMiddleware);

// GET /api/advocate/dashboard/hearings/cases
router.get("/cases", listMyCasesForHearings);

// GET /api/advocate/dashboard/hearings/cases/:caseId
router.get("/cases/:caseId", listCaseHearings);

// POST /api/advocate/dashboard/hearings/cases/:caseId
router.post("/cases/:caseId", createHearing);

// PATCH /api/advocate/dashboard/hearings/:hearingId/status
router.patch("/:hearingId/status", updateHearingStatusAndLogs);

// PUT /api/advocate/dashboard/hearings/:hearingId/attendance
router.put("/:hearingId/attendance", upsertAttendance);

// PUT /api/advocate/dashboard/hearings/:hearingId/proceedings
router.put("/:hearingId/proceedings", upsertProceedings);

// Evidence
router.post("/:hearingId/evidence", addEvidence);
router.get("/:hearingId/evidence", listEvidence);

// Drafts
router.post("/:hearingId/drafts", addDraft);
router.get("/:hearingId/drafts", listDrafts);

export default router;

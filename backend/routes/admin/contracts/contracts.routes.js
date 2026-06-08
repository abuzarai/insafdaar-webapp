import express from "express";
import {
  adminListContractsPendingApproval,
  adminGetCaseContract,
  adminApproveContract,
  adminRejectContract,
} from "../../../controllers/admin/contracts/contracts.admin.controller.js";

const router = express.Router();

router.get("/pending", adminListContractsPendingApproval);
router.get("/cases/:caseId", adminGetCaseContract);
router.post("/cases/:caseId/approve", adminApproveContract);
router.post("/cases/:caseId/reject", adminRejectContract);

export default router;

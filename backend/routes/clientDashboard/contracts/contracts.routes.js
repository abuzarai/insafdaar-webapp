import express from "express";
import {
  getCaseContract,
  requestContractSigningOtpByClient,
  verifyContractSigningOtpByClient,
  signCaseContractByClient,
} from "../../../controllers/clientDashboard/contracts/contracts.controller.js";

const router = express.Router();

router.get("/cases/:caseId", getCaseContract);
router.post("/cases/:caseId/sign/request-otp", requestContractSigningOtpByClient);
router.post("/cases/:caseId/sign/verify-otp", verifyContractSigningOtpByClient);
router.post("/cases/:caseId/sign", signCaseContractByClient);

export default router;

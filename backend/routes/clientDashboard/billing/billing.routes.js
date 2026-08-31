import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  listMyVouchers,
  getMyVoucherById,
  uploadVoucherProof,
} from "../../../controllers/clientDashboard/billing/vouchers.controller.js";

import { proofUpload } from "./billing.uploads.js";

const router = express.Router();

// /api/client/dashboard/billing/...

// vouchers (admin-generated)
router.get("/vouchers", authMiddleware, listMyVouchers);
router.get("/vouchers/:billingId", authMiddleware, getMyVoucherById);

// upload payment proof for voucher
router.post(
  "/vouchers/:billingId/proof",
  authMiddleware,
  proofUpload.single("proof"),
  uploadVoucherProof
);

export default router;

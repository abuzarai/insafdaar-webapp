import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  getMyInvoices,
  getInvoiceById,
  uploadPaymentProof,
} from "../../../controllers/clientDashboard/billing/billing.controller.js";

import {
  listMyVouchers,
  getMyVoucherById,
  uploadVoucherProof, // STEP 2
} from "../../../controllers/clientDashboard/billing/vouchers.controller.js";

import { proofUpload } from "./billing.uploads.js";

const router = express.Router();

// /api/client/dashboard/billing/...

// invoices (existing – unchanged)
router.get("/invoices", authMiddleware, getMyInvoices);
router.get("/invoices/:invoiceId", authMiddleware, getInvoiceById);

router.post(
  "/invoices/:invoiceId/proof",
  authMiddleware,
  proofUpload.single("proof"),
  uploadPaymentProof
);

// vouchers (admin-generated)
router.get("/vouchers", authMiddleware, listMyVouchers);
router.get("/vouchers/:billingId", authMiddleware, getMyVoucherById);

// ✅ STEP 2 — upload payment proof for voucher
router.post(
  "/vouchers/:billingId/proof",
  authMiddleware,
  proofUpload.single("proof"),
  uploadVoucherProof
);

export default router;

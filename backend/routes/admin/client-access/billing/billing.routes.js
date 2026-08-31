import express from "express";
import { upload } from "../../../../middleware/upload.js";

// ✅ Use same auth stack everywhere (req.user must exist)
import { authMiddleware } from "../../../../middleware/authMiddleware.js";
import { adminOnly } from "../../../../middleware/adminOnly.js";

import {
  createVoucher,
  createVoucherForCase,
  listVoucherCaseOptions,
  sendVoucherToClient,
  listClientBilling,
  listAllClientBilling,
  listPendingProofs,
  verifyProof,
  rejectProof,
  setCasePaymentManualStatus,
} from "../../../../controllers/admin/client-access/billing/billing.controller.js";

const router = express.Router();

/**
 * ✅ Protect all billing admin routes
 * If your parent admin router already runs authMiddleware+adminOnly,
 * you can remove this router.use(...) entirely.
 */
router.use(authMiddleware, adminOnly);

// vouchers
// ✅ keep upload optional: admin may attach extra file if needed (rare)
router.post("/vouchers", upload.single("voucher"), createVoucher);
router.get("/cases/options", listVoucherCaseOptions);
router.post("/cases/:caseId/vouchers", upload.single("voucher"), createVoucherForCase);

// ✅ generates pdf + sends to client
router.post("/vouchers/:billingId/send", sendVoucherToClient);

// client billing overview
router.get("/all", listAllClientBilling);
router.get("/client/:userId", listClientBilling);

// payment proofs
router.get("/proofs/pending", listPendingProofs);
router.patch("/proofs/:proofId/verify", verifyProof);
router.patch("/proofs/:proofId/reject", rejectProof);
router.post("/cases/:caseId/manual-payment-status", setCasePaymentManualStatus);

export default router;

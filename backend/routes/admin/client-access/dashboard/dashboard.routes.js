import express from "express";
import { authMiddleware } from "../../../../middleware/authMiddleware.js";
import { adminOnly } from "../../../../middleware/adminMiddleware.js";

// ✅ CORRECT controller import path
import {
  adminClientDashboardSummary,
  adminClientMyCases,
  adminClientNotifications,
  adminClientFeedback,
  adminClientBilling,
} from "../../../../controllers/admin/client-access/dashboard/clientDashboard.controller.js";

const router = express.Router();

// Base path: /api/admin/client-access/dashboard/:id
router.use(authMiddleware, adminOnly);

router.get("/:id/summary", adminClientDashboardSummary);
router.get("/:id/cases", adminClientMyCases);
router.get("/:id/notifications", adminClientNotifications);
router.get("/:id/feedback", adminClientFeedback);
router.get("/:id/billing", adminClientBilling);

export default router;

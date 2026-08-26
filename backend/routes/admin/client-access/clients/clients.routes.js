import express from "express";
import { authMiddleware } from "../../../../middleware/authMiddleware.js";
import { adminOnly } from "../../../../middleware/adminOnly.js";

import {
  listClients,
  getClientFullProfile,
  updateClient,
  deleteClient,
} from "../../../../controllers/admin/client-access/clients/clients.controller.js";

import {
  adminClientDashboardSummary,
  adminClientMyCases,
  adminClientNotifications,
  adminClientBilling,
  adminClientFeedback,
} from "../../../../controllers/admin/client-access/dashboard/clientDashboard.controller.js";

const router = express.Router();

// protect all routes
router.use(authMiddleware, adminOnly);

// Clients CRUD
router.get("/", listClients);
router.get("/:id", getClientFullProfile);
router.patch("/:id", updateClient);
router.delete("/:id", deleteClient);

// Client Dashboard (Admin View)
router.get("/:id/dashboard/summary", adminClientDashboardSummary);
router.get("/:id/dashboard/cases", adminClientMyCases);
router.get("/:id/dashboard/notifications", adminClientNotifications);
router.get("/:id/dashboard/billing", adminClientBilling);
router.get("/:id/dashboard/feedback", adminClientFeedback);

export default router;

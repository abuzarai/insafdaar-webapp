import express from "express";
import { authMiddleware } from "../../middleware/authMiddleware.js";
import { adminOnly } from "../../middleware/adminOnly.js";

// client-access
import clientsRoutes from "./client-access/clients/clients.routes.js";
import activityRoutes from "./client-access/activity/activity.routes.js";
import statsRoutes from "./client-access/stats/stats.routes.js";
import dashboardRoutes from "./client-access/dashboard/dashboard.routes.js";
import billingRoutes from "./client-access/billing/billing.routes.js";
import notificationsRoutes from "./client-access/notifications/notifications.routes.js"; // ✅ client notifications
import casesRoutes from "./client-access/cases/cases.routes.js";
import feedbackRoutes from "./client-access/feedback/feedback.routes.js";

// ✅ NEW: admin can view client's Start Case intake (draft + uploaded docs + voice) + assign advocate
import adminStartCaseRoutes from "./client-access/start-case/startCase.routes.js"; // ✅ ADD

// ✅ admin dashboard notifications (bell)
import adminDashboardNotificationsRoutes from "./notifications/adminNotifications.routes.js";

// advocate-access
import advocateListRoutes from "./advocate-access/advocates/advocates.routes.js";

// performance
import performanceRoutes from "./performance/performance.routes.js";
import adminCaseDiscussionRoutes from "./caseDiscussion/caseDiscussion.routes.js";
import adminContractRoutes from "./contracts/contracts.routes.js";


const router = express.Router();

// ✅ protect all admin routes once
router.use(authMiddleware, adminOnly);

// ------------------ existing ------------------
router.use("/stats", statsRoutes);
router.use("/clients", clientsRoutes);
router.use("/activity", activityRoutes);

// ✅ admin dashboard notifications endpoint
// GET /api/admin/notifications
router.use("/notifications", adminDashboardNotificationsRoutes);

// ------------------ client-access ------------------
router.use("/client-access/dashboard", dashboardRoutes);
router.use("/client-access/billing", billingRoutes);
router.use("/client-access/notifications", notificationsRoutes);
router.use("/client-access/cases", casesRoutes); // ✅ /api/admin/client-access/cases/:userId
router.use("/client-access/feedback", feedbackRoutes); // ✅ /api/admin/client-access/feedback/:userId

// ✅ NEW: Start Case intake access for admin
// base: /api/admin/client-access/start-case
// - GET    /active?userId=123
// - GET    /documents?caseId=456
// - GET    /voice?caseId=456
// - POST   /assign-advocate   { caseId, advocateId, note? }
router.use("/client-access/start-case", adminStartCaseRoutes);

// ------------------ advocate-access ------------------
router.use("/advocates", advocateListRoutes);

// ------------------ performance ------------------
router.use("/performance", performanceRoutes);



// router.use("/case-discussion", adminCaseDiscussionRoutes);
// case discussion (meeting requests)
router.use("/case-discussion", adminCaseDiscussionRoutes);
router.use("/contracts", adminContractRoutes);



export default router;

import express from "express";

import startCaseRoutes from "./startCase/startCase.routes.js";
import billingRoutes from "./billing/billing.routes.js";
import caseDetailsRoutes from "./caseDetails/caseDetails.routes.js";

// modules
import feedbackRoutes from "./feedback/feedback.routes.js";
import notificationsRoutes from "./notifications/notifications.routes.js";
import myCasesRoutes from "./myCases/myCases.routes.js";

import meetingsRoutes from "./meetings/meetings.routes.js";
import contractsRoutes from "./contracts/contracts.routes.js";

// ✅ AUTH (JWT)
import { authMiddleware } from "../../middleware/authMiddleware.js";

const router = express.Router();

// ✅ Protect ALL client dashboard routes
router.use(authMiddleware);

// core dashboard modules
router.use("/start-case", startCaseRoutes);
router.use("/billing", billingRoutes);
router.use("/case-details", caseDetailsRoutes);

// ✅ My Cases (for MyCasesSection)
router.use("/cases", myCasesRoutes);

// feedback
router.use("/feedback", feedbackRoutes);

// notifications
router.use("/notifications", notificationsRoutes);
router.use("/meetings", meetingsRoutes);
router.use("/contracts", contractsRoutes);


export default router;

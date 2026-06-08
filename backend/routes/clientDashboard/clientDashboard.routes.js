import express from "express";

import startCaseRoutes from "./start-case/startCase.routes.js"; // your existing
import billingRoutes from "./billing/billing.routes.js";
import caseDetailsRoutes from "./caseDetails/caseDetails.routes.js";

const router = express.Router();

// /api/client/dashboard/...
router.use("/start-case", startCaseRoutes);
router.use("/billing", billingRoutes);
router.use("/case-details", caseDetailsRoutes);

export default router;

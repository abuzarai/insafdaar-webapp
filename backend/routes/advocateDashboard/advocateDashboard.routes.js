import express from "express";

import profileRoutes from "./profile/profile.routes.js";
import advocateCasesRoutes from "./cases/cases.routes.js";
import caseDiscussionRoutes from "./caseDiscussion/caseDiscussion.routes.js";
import casePreparationRoutes from "./casePreparation/casePreparation.routes.js";
import caseStagesRoutes from "./caseStages/caseStages.routes.js";
import advocateNotificationsRoutes from "./notifications/advocateNotifications.routes.js";
import caseClosureRoutes from "./caseClosure/caseClosure.routes.js";
import contractRoutes from "./contracts/contracts.routes.js";

// ✅ ADD THIS
import caseHearingRoutes from "./caseHearing/caseHearing.routes.js";


 


const router = express.Router();

// Profile routes
router.use("/profile", profileRoutes);

// Advocate cases routes
router.use("/cases", advocateCasesRoutes);

// Case discussion routes
router.use("/case-discussion", caseDiscussionRoutes);

// ✅ Case preparation routes
router.use("/case-preparation", casePreparationRoutes);

// ✅  caseStagesRoutes
router.use("/", caseStagesRoutes);

router.use("/", advocateNotificationsRoutes);


router.use("/", caseClosureRoutes);

router.use("/hearings", caseHearingRoutes);
router.use("/contracts", contractRoutes);
 

 



export default router;

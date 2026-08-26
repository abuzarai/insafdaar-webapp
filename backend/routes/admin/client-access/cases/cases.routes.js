import express from "express";
import { authMiddleware } from "../../../../middleware/authMiddleware.js";
import { adminOnly } from "../../../../middleware/adminOnly.js";
// import { adminListClientCases } from "../../../../controllers/admin/client-access/cases/adminCases.controller.js";

import { adminListClientCases } from "../../../../controllers/admin/client-access/myCases/adminCases.controller.js";

const router = express.Router();

/**
 * GET /api/admin/client-access/cases/:userId
 */
router.get("/:userId", authMiddleware, adminOnly, adminListClientCases);

export default router;

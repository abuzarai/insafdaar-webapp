import express from "express";
import { authMiddleware } from "../../../../middleware/authMiddleware.js";
import { adminOnly } from "../../../../middleware/adminOnly.js";
import { adminListClientFeedback } from "../../../../controllers/admin/client-access/feedback/adminFeedback.controller.js";

const router = express.Router();

/**
 * GET /api/admin/client-access/feedback/:userId
 */
router.get("/:userId", authMiddleware, adminOnly, adminListClientFeedback);

export default router;

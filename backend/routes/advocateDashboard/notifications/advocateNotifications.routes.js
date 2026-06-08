import { Router } from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";
import {
  getMyAdvocateNotifications,
  markAdvocateNotificationRead,
  markAllAdvocateNotificationsRead,
} from "../../../controllers/advocateDashboard/notifications/advocateNotifications.controller.js";

const router = Router();

// GET list
router.get("/notifications", authMiddleware, getMyAdvocateNotifications);

// PATCH mark one read
router.patch("/notifications/:id/read", authMiddleware, markAdvocateNotificationRead);

// PATCH mark all read
router.patch("/notifications/read-all", authMiddleware, markAllAdvocateNotificationsRead);

export default router;

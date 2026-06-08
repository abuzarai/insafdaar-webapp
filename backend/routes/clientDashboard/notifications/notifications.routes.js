import express from "express";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

import {
  listMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllRead,
  clearReadNotifications,
  deleteNotification,
} from "../../../controllers/clientDashboard/notifications/notifications.controller.js";

const router = express.Router();

// /api/client/dashboard/notifications

// List + filters + pagination
router.get("/", authMiddleware, listMyNotifications);

// Badge count
router.get("/unread-count", authMiddleware, getUnreadCount);

// Mark single notification read/unread
router.patch("/:id/read", authMiddleware, markNotificationRead);

// Mark all as read
router.patch("/mark-all-read", authMiddleware, markAllRead);

// Delete all read notifications
router.delete("/clear-read", authMiddleware, clearReadNotifications);

// Delete single notification
router.delete("/:id", authMiddleware, deleteNotification);

export default router;

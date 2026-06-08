import express from "express";
import {
  listClientNotifications,
  listRecentNotifications,
  markNotificationRead,
} from "../../../../controllers/admin/client-access/notifications/notifications.controller.js";

const router = express.Router();

router.get("/client/:userId", listClientNotifications);
router.get("/recent", listRecentNotifications);
router.patch("/:id/read", markNotificationRead);

export default router;



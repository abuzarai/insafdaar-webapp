import express from "express";
import { adminOnly } from "../../../../middleware/adminOnly.js";
import { listActivityFeed } from "../../../../controllers/admin/client-access/activity/activity.controller.js";

const router = express.Router();

router.get("/", adminOnly, listActivityFeed);

export default router;

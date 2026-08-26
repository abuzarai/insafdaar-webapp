import express from "express";
import advocateDashboardRoutes from "./advocateDashboard.routes.js";

const router = express.Router();

router.use("/", advocateDashboardRoutes);

export default router;

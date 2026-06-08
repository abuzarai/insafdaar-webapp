import { Router } from "express";

import {
  getPerformanceOverview,
  getPerformanceTimeseries,
  getPerformanceErrors,
  getPerformanceSlowEndpoints,
  getPerformanceSystem,
  getPerformanceEndpoints,
  getPerformanceStatusCodes,
  getPerformanceTraffic,
} from "../../../controllers/admin/performance/performance.controller.js";

const router = Router();

/*
  Admin auth is already enforced in:
  routes/admin/index.js
*/

// Performance APIs
router.get("/overview", getPerformanceOverview);
router.get("/timeseries", getPerformanceTimeseries);
router.get("/errors", getPerformanceErrors);
router.get("/slow", getPerformanceSlowEndpoints);
router.get("/system", getPerformanceSystem);
router.get("/endpoints", getPerformanceEndpoints);
router.get("/status-codes", getPerformanceStatusCodes);
router.get("/traffic", getPerformanceTraffic);

export default router;

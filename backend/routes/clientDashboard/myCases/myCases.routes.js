import { Router } from "express";
import {
  listMyCases,
  deleteMyCase,
} from "../../../controllers/clientDashboard/myCases/myCases.controller.js";
import { authMiddleware } from "../../../middleware/authMiddleware.js";

const router = Router();

// ✅ protected route (client must be logged in)
router.get("/", authMiddleware, listMyCases);
router.delete("/:caseId", authMiddleware, deleteMyCase);

export default router;

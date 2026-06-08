import { Router } from "express";
// import requireAuth from "../../../middleware/auth.js";
import { authMiddleware as requireAuth } from "../../../middleware/authMiddleware.js";

import { upload } from "./profile.uploads.js";

import {
  getFullProfile,
  patchProfile,
  getAvailability,
  putAvailability,
  getDocuments,
  uploadDocument,
  addWork,
  deleteWork,
  addEducation,
  deleteEducation,
} from "../../../controllers/advocateDashboard/profile/profile.controller.js";

const router = Router();

router.get("/", requireAuth, getFullProfile);
router.patch("/", requireAuth, patchProfile);

router.get("/availability", requireAuth, getAvailability);
router.put("/availability", requireAuth, putAvailability);

router.get("/documents", requireAuth, getDocuments);
router.post("/documents/:docKey/upload", requireAuth, upload.single("file"), uploadDocument);

router.post("/work-history", requireAuth, addWork);
router.delete("/work-history/:id", requireAuth, deleteWork);

router.post("/education", requireAuth, addEducation);
router.delete("/education/:id", requireAuth, deleteEducation);

export default router;

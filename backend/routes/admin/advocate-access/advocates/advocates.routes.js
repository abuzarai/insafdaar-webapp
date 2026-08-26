import { Router } from "express";

import {
  getAdminAdvocates,
  patchAdminAdvocate,
  deleteAdminAdvocate,

  // ✅ NEW (full profile + verification workflow)
  getAdminAdvocateFullProfile,
  patchAdminAdvocateDocument,
  approveAdvocate,
  unapproveAdvocate,
} from "../../../../controllers/admin/advocate-access/advocates/advocates.controller.js";

const router = Router();

// ✅ Admin protection already applied in routes/admin/index.js

// list
router.get("/", getAdminAdvocates);

// edit basic
router.patch("/:id", patchAdminAdvocate);

// delete
router.delete("/:id", deleteAdminAdvocate);

// ✅ FULL PROFILE (like client profile page)
router.get("/:id/full-profile", getAdminAdvocateFullProfile);

// ✅ DOC REVIEW (verify / reject / pending + note)
router.patch("/:id/documents/:docType", patchAdminAdvocateDocument);

// ✅ APPROVE / UNAPPROVE advocate
router.post("/:id/approve", approveAdvocate);
router.post("/:id/unapprove", unapproveAdvocate);

export default router;

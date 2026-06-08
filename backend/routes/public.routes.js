import express from "express";
import { getPublicAdvocates } from "../controllers/public/advocates.controller.js";

const router = express.Router();

// GET /api/public/advocates
router.get("/advocates", getPublicAdvocates);

export default router;

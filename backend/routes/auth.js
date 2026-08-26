// backend/routes/auth.js
import express from "express";
import { loginUser, getProfile } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import verifyOtpRoutes from "./verifyOtp.js";

const router = express.Router();

// ✅ public routes
router.post("/login", loginUser);

// ✅ OTP verification route
router.use("/", verifyOtpRoutes);

// ✅ protected route example
router.get("/profile", authMiddleware, getProfile);

export default router;

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";
import { verifyToken } from "./middleware/authMiddleware.js";
import { uploadGuard } from "./utils/uploadGuard.js";

// routes
import clientRoutes from "./routes/client.js";
import advocateRoutes from "./routes/advocate.js";
import authRoutes from "./routes/auth.js";

import clientProfileRoutes from "./routes/clientProfile.js";
import clientDocumentsRoutes from "./routes/clientDocuments.js";
import clientUploadsRoutes from "./routes/clientUploads.js";

// dashboards
import clientDashboardRoutes from "./routes/clientDashboard/index.js";
import advocateDashboardRoutes from "./routes/advocateDashboard/index.js";

// admin
import adminRoutes from "./routes/admin/index.js";

// voice interview integration
import interviewRoutes from "./routes/interviews.js";
import webhookRoutes from "./routes/webhooks.js";
import legalAssistantRoutes from "./routes/legalAssistant.routes.js";
import internalDraftRoutes from "./routes/internalDraft.routes.js";

// ✅ public routes
import publicRoutes from "./routes/public.routes.js";

// ✅ request logger middleware
import { apiLogger } from "./middleware/apiLogger.js";

import { startMeetingRemindersJob } from "./jobs/meetingReminders.job.js";
import { startCourtHearingRemindersJob } from "./jobs/hearingReminders.job.js";
import { startDocumentExtractionJob } from "./jobs/documentExtraction.job.js";



dotenv.config();

const app = express();

/**
 * ✅ CORS (FIXED for credentials: "include")
 * Allow extra origins via CORS_ALLOWED_ORIGINS (comma-separated).
 */
const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000", ...envOrigins];

app.use(
  cors({
    origin: (origin, cb) => {
      // allow Postman / server-to-server (no Origin header)
      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-webhook-secret",
      "x-chat-owner-id",
    ],
  })
);

// ✅ handle OPTIONS safely (no app.options("*"))
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

// ✅ ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ serve uploaded files (authenticated; avatars stay public)
app.use("/uploads", uploadGuard(verifyToken));

// ✅ log requests (skip uploads/static)
app.use(
  apiLogger({
    skip: (req) => {
      const url = (req.originalUrl || req.url || "").split("?")[0];
      return url.startsWith("/uploads") || url.startsWith("/favicon.ico");
    },
  })
);

app.get("/", (req, res) =>
  res.json({ message: "Insafdaar Backend Running ✅" })
);

app.get("/test-db", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ dbTime: result.rows[0].now });
  } catch (err) {
    next(err);
  }
});

// ✅ register routes
app.use("/api/register/client", clientRoutes);
app.use("/api/register/advocate", advocateRoutes);
app.use("/api/auth", authRoutes);

// ✅ client core routes
app.use("/api/client", clientProfileRoutes);
app.use("/api/client", clientDocumentsRoutes);
app.use("/api/client", clientUploadsRoutes);

// ✅ client dashboard modules
app.use("/api/client/dashboard", clientDashboardRoutes);

// ✅ advocate dashboard modules
app.use("/api/advocate/dashboard", advocateDashboardRoutes);

// ✅ admin
app.use("/api/admin", adminRoutes);

// ✅ public (IMPORTANT: must be BEFORE 404 fallback)
app.use("/api/public", publicRoutes);

// voice interview integration
app.use("/api/interviews", interviewRoutes);
app.use("/api/webhooks", webhookRoutes);

// legal assistant proxy
app.use("/api/legal-assistant", legalAssistantRoutes);

// drafting assistant internal integration
app.use("/internal/draft", internalDraftRoutes);

// ✅ 404 fallback (JSON only) — must be AFTER all routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ✅ Global error handler (JSON only)
app.use((err, req, res, next) => {
  res.locals.errorMessage = err?.message || null;

  console.error("❌ ERROR:", err);
  const status = err?.statusCode || err?.status || 500;

  res.status(status).json({
    error: err?.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startMeetingRemindersJob();
  console.log("⏰ Meeting reminder cron started (24h + 6h).");
  startCourtHearingRemindersJob();
  console.log("⏰ Court hearing reminder cron started (24h + 6h).");
  startDocumentExtractionJob();
  console.log("⏰ Document extraction cron started (every 2 minutes).");
});

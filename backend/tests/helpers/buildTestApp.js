import express from "express";
import authRoutes from "../../routes/auth.js";
import clientRegisterRoutes from "../../routes/client.js";
import advocateRegisterRoutes from "../../routes/advocate.js";
import interviewRoutes from "../../routes/interviews.js";
import legalAssistantRoutes from "../../routes/legalAssistant.routes.js";
import billingRoutes from "../../routes/clientDashboard/billing/billing.routes.js";
import clientProfileRoutes from "../../routes/clientProfile.js";
import advocateProfileRoutes from "../../routes/advocateDashboard/profile/profile.routes.js";
import webhookRoutes from "../../routes/webhooks.js";

export function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.use("/api/auth", authRoutes);
  app.use("/api/register/client", clientRegisterRoutes);
  app.use("/api/register/advocate", advocateRegisterRoutes);
  app.use("/api/interviews", interviewRoutes);
  app.use("/api/legal-assistant", legalAssistantRoutes);
  app.use("/api/client/dashboard/billing", billingRoutes);
  app.use("/api/client/profile", clientProfileRoutes);
  app.use("/api/advocate/dashboard/profile", advocateProfileRoutes);
  app.use("/api/webhooks", webhookRoutes);

  app.use((err, _req, res, _next) => {
    res.status(err?.status || 500).json({
      error: err?.message || "Internal server error",
    });
  });

  return app;
}

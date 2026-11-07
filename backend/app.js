
import express from "express";
import cors from "cors";
import helmet from "helmet";
import sellerRoutes from "./routes/sellerRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import riskRoutes from "./routes/riskRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import investigationCaseRoutes from "./routes/investigationCaseRoutes.js";
import investigationCaseAuditRoutes from "./routes/investigationCaseAuditRoutes.js";
import { createPaymentRouter } from "./routes/paymentRoutes.js";
import { paymentService } from "./services/paymentService.js";
import { createPayPalWebhookController } from "./controllers/paypalWebhookController.js";
import { requireAuth } from "./middleware/requireAuth.js";
import {
  notFoundHandler,
  errorHandler,
} from "./middleware/errorHandler.js";

export function createApp({ payments = paymentService, logger = console } = {}) {
  const app = express();
  // Render's edge/load balancer is the single hop directly in front of the app.
  // Trust only that hop so req.ip uses its rightmost forwarded client address.
  app.set("trust proxy", 1);
  const frontendOrigin = process.env.FRONTEND_BASE_URL
    ? new URL(process.env.FRONTEND_BASE_URL).origin
    : process.env.NODE_ENV === "production" ? null : "http://localhost:5173";
  const allowedOrigins = new Set(frontendOrigin ? [frontendOrigin] : []);

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  }));
  app.use(express.json({ limit: "100kb", inflate: false }));
  app.use("/api/auth", authRoutes);
  app.post("/api/webhooks/paypal", createPayPalWebhookController({ service: payments, logger }));
  app.use("/api/payments", createPaymentRouter({ service: payments }));

// Public health check
app.use("/api/health", healthRoutes);

// Require login for seller and risk operations
app.use("/api/sellers", requireAuth, sellerRoutes);
app.use("/api/sellers", requireAuth, sellerRoutes);
app.use("/api/investigation-cases", requireAuth, investigationCaseRoutes);
app.use(
  "/api/investigation-cases",
  requireAuth,
  investigationCaseAuditRoutes
);
app.use("/api/risk", requireAuth, riskRoutes);
app.use("/api/risk", requireAuth, riskRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

  return app;
}

const app = createApp();
export default app;

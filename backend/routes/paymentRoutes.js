import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { paymentRateLimit } from "../middleware/authRateLimit.js";
import { paymentService } from "../services/paymentService.js";

export function createPaymentRouter({ service = paymentService } = {}) {
  const router = Router();
  router.use(requireAuth);
  router.use(paymentRateLimit);

  router.post("/", async (req, res, next) => {
    try {
      const payment = await service.createPayment({
        buyerId: req.user.sub,
        body: req.body,
        idempotencyKey: req.get("Idempotency-Key"),
      });
      return res.status(200).json({ success: true, payment });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      return res.json({ success: true, payments: await service.listPayments({ buyerId: req.user.sub }) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/review-queue", async (req, res, next) => {
    try {
      if (req.user.role !== "ANALYST") {
        return res.status(403).json({ success: false, message: "Analyst access is required." });
      }
      return res.json({ success: true, payments: await service.listReviewQueue() });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:paymentId", async (req, res, next) => {
    try {
      return res.json({ success: true, payment: await service.getPayment({ buyerId: req.user.sub, paymentId: req.params.paymentId }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:paymentId/assess-risk", async (req, res, next) => {
    try {
      const payment = await service.getPayment({ buyerId: req.user.sub, paymentId: req.params.paymentId });
      return res.json({ success: true, riskAssessment: payment.riskAssessmentSnapshot });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:paymentId/capture", async (req, res, next) => {
    try {
      return res.json({ success: true, payment: await service.capturePayment({ buyerId: req.user.sub, paymentId: req.params.paymentId }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:paymentId/cancel", async (req, res, next) => {
    try {
      return res.json({ success: true, payment: await service.cancelPayment({ buyerId: req.user.sub, paymentId: req.params.paymentId }) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

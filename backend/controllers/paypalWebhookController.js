const SAFE_ERROR_MESSAGES = {
  INVALID_WEBHOOK: "Webhook event is invalid.",
  INVALID_WEBHOOK_SIGNATURE: "PayPal webhook signature verification failed.",
  PAYPAL_NOT_CONFIGURED: "PayPal webhook verification is not configured.",
  PAYPAL_API_REJECTED: "PayPal rejected the webhook verification request.",
  WEBHOOK_PAYMENT_MISMATCH: "Verified webhook did not match the stored payment.",
  WEBHOOK_REFUND_OVERFLOW: "Verified refund total exceeded the payment amount.",
};

export function createPayPalWebhookController({ service, logger = console }) {
  return async function paypalWebhook(req, res, next) {
    const eventType = safeField(req.body?.event_type, /^[A-Z0-9_.-]{1,100}$/);
    const eventId = safeField(req.body?.id, /^[A-Za-z0-9_-]{1,128}$/);
    let verificationResult = "NOT_ATTEMPTED";
    let duplicate = false;

    writeLog(logger, "info", "request_received", { eventType, eventId });
    res.once("finish", () => {
      writeLog(logger, "info", "response_finished", {
        eventType,
        eventId,
        verificationResult,
        duplicate,
        status: res.statusCode,
      });
    });

    try {
      const headers = {
        authAlgo: req.get("paypal-auth-algo"),
        certUrl: req.get("paypal-cert-url"),
        transmissionId: req.get("paypal-transmission-id"),
        transmissionSig: req.get("paypal-transmission-sig"),
        transmissionTime: req.get("paypal-transmission-time"),
      };
      const result = await service.processWebhook({
        headers,
        event: req.body,
        onVerificationResult(verified) {
          const passed = verified === true;
          verificationResult = passed ? "SUCCESS" : "FAILURE";
          writeLog(logger, passed ? "info" : "warn", "verification_result", {
            eventType,
            eventId,
            verificationResult,
          });
        },
      });
      duplicate = result.duplicate === true;
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      if (verificationResult === "NOT_ATTEMPTED" && error?.code !== "INVALID_WEBHOOK") {
        verificationResult = "ERROR";
      }
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
      const errorCode = Object.hasOwn(SAFE_ERROR_MESSAGES, error?.code)
        ? error.code
        : "WEBHOOK_PROCESSING_FAILED";
      writeLog(logger, "error", "processing_failed", {
        eventType,
        eventId,
        verificationResult,
        errorCode,
        errorMessage: SAFE_ERROR_MESSAGES[errorCode] || "Webhook processing failed.",
        status,
      });
      return next(error);
    }
  };
}

function safeField(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : "unavailable";
}

function writeLog(logger, level, event, fields) {
  try {
    const method = typeof logger?.[level] === "function" ? logger[level] : console[level];
    method.call(logger, "PayPal webhook", { event, ...fields });
  } catch {
    // A logging failure must not change webhook response or reconciliation behavior.
  }
}

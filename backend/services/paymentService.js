import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import PayPalWebhookEvent from "../models/PayPalWebhookEvent.js";
import Seller from "../models/Seller.js";
import { evaluateTransaction } from "../risk-engine/riskService.js";
import { paypalClient } from "./paypalClient.js";

const MAX_AMOUNT = 10_000;
const CURRENCY_EXPONENTS = Object.freeze({ USD: 2, EUR: 2, GBP: 2 });
const ORDER_LEASE_MS = 30_000;
const CAPTURE_LEASE_MS = 60_000;

export function validatePaymentInput(input = {}) {
  const { sellerId, amount, currency } = input;
  if (typeof sellerId !== "string" || !sellerId.trim() || sellerId.length > 100) {
    throw httpError(400, "INVALID_SELLER", "Provide a valid sellerId.");
  }
  if (typeof amount !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(amount)) {
    throw httpError(400, "INVALID_AMOUNT", "Amount must be a positive decimal with no more than two fractional digits.");
  }
  const exponent = CURRENCY_EXPONENTS[currency];
  if (typeof currency !== "string" || exponent === undefined) {
    throw httpError(400, "INVALID_CURRENCY", "Currency must be USD, EUR, or GBP.");
  }
  const amountMinor = decimalToMinorUnits(amount, exponent);
  if (amountMinor <= 0n || amountMinor > BigInt(MAX_AMOUNT) * (10n ** BigInt(exponent))) {
    throw httpError(400, "INVALID_AMOUNT", `Amount must be greater than zero and no more than ${MAX_AMOUNT.toFixed(2)}.`);
  }
  return {
    sellerId: sellerId.trim(),
    amount: minorUnitsToDecimal(amountMinor, exponent),
    currency,
  };
}

export function createPaymentService({ paypal = paypalClient } = {}) {
  async function createPayment({ buyerId, body, idempotencyKey }) {
    if (!mongoose.isValidObjectId(buyerId)) throw httpError(401, "UNAUTHENTICATED", "Authentication required.");
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      throw httpError(400, "INVALID_IDEMPOTENCY_KEY", "Provide an Idempotency-Key header between 8 and 100 safe characters.");
    }
    const input = validatePaymentInput(body);
    const seller = await Seller.findOne({ sellerId: input.sellerId }).lean();
    if (!seller) throw httpError(404, "SELLER_NOT_FOUND", "Seller not found.");
    let payment = await Payment.findOne({ buyerId, idempotencyKey });
    if (payment) {
      if (payment.sellerId !== input.sellerId || payment.amount !== input.amount || payment.currency !== input.currency) {
        throw httpError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different payment.");
      }
      if (["CREATED", "RISK_PENDING"].includes(payment.status) && !payment.paypalOrderId) {
        return startOrderFlow(payment, seller);
      }
      return serializePayment(payment);
    }

    const paymentId = new mongoose.Types.ObjectId().toString();
    try {
      payment = await Payment.create({
        paymentId,
        buyerId,
        sellerId: input.sellerId,
        amount: input.amount,
        currency: input.currency,
        idempotencyKey,
        status: "CREATED",
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      payment = await Payment.findOne({ buyerId, idempotencyKey });
      if (!payment) throw error;
      if (payment.sellerId !== input.sellerId || payment.amount !== input.amount || payment.currency !== input.currency) {
        throw httpError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different payment.");
      }
      if (payment.paypalOrderId) return serializePayment(payment);
    }
    return startOrderFlow(payment, seller);
  }

  async function startOrderFlow(payment, seller) {
    const now = new Date();
    const claimed = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        paypalOrderId: null,
        $or: [
          { status: "CREATED" },
          { status: "RISK_PENDING", orderLeaseUntil: { $lte: now } },
        ],
      },
      { $set: { status: "RISK_PENDING", orderLeaseUntil: new Date(now.getTime() + ORDER_LEASE_MS) } },
      { new: true }
    );
    if (!claimed) return serializePayment(await Payment.findById(payment._id));

    try {
      const order = await paypal.createOrder({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: payment.paymentId,
          custom_id: payment.paymentId,
          invoice_id: payment.paymentId,
          description: "TrustMesh AI Sandbox checkout",
          amount: { currency_code: payment.currency, value: payment.amount },
        }],
        application_context: {
          brand_name: "TrustMesh AI Sandbox",
          user_action: "PAY_NOW",
          return_url: `${frontendBaseUrl()}/?paymentId=${encodeURIComponent(payment.paymentId)}`,
          cancel_url: `${frontendBaseUrl()}/?paymentId=${encodeURIComponent(payment.paymentId)}&cancelled=1`,
        },
      }, `tm-order-${payment.paymentId}`);

      if (typeof order?.id !== "string" || !Array.isArray(order.links)) {
        throw new Error("PayPal Sandbox returned an invalid order response.");
      }

      const currentSeller = await Seller.findOne({ sellerId: payment.sellerId }).lean();
      if (!currentSeller) throw httpError(404, "SELLER_NOT_FOUND", "Seller not found.");
      const graphSellers = (await Seller.find({}).lean()).map((item) => ({
        id: item.sellerId,
        beneficiaryIds: item.beneficiaryIds,
      }));
      const allSellers = await Seller.find({}).select("sellerId riskStatus").lean();
      const flaggedSellerIds = allSellers.filter((item) => item.riskStatus === "FLAGGED").map((item) => item.sellerId);
      const assessment = evaluateTransaction({
        evidence: {
          incompleteSellerVerification: currentSeller.verificationStatus !== "VERIFIED",
          sellerFlagged: currentSeller.riskStatus === "FLAGGED",
        },
        targetSellerId: seller.sellerId,
        sellers: graphSellers,
        flaggedSellerIds,
      });
      const snapshot = Object.freeze({
        score: assessment.score,
        decision: assessment.decision,
        findings: assessment.findings,
        graph: assessment.graph,
        evidence: {
          sellerFlagged: currentSeller.riskStatus === "FLAGGED",
          incompleteSellerVerification: currentSeller.verificationStatus !== "VERIFIED",
          flaggedRelatedSeller: assessment.graph?.riskSignals.some((signal) => signal.type === "SHARED_BENEFICIARY_WITH_FLAGGED_SELLER") || false,
        },
        assessedAt: new Date().toISOString(),
        evidenceAvailability: {
          sellerVerification: "AVAILABLE",
          sharedBeneficiaryNetwork: "AVAILABLE",
          buyerTransactionVelocity: "UNAVAILABLE_NO_PAYMENT_HISTORY",
          unusualAmountBaseline: "UNAVAILABLE_NO_BUYER_BASELINE",
        },
        disclaimer: "Risk decisions are advisory outside TrustMesh-controlled Sandbox capture; findings are not proof of fraud.",
      });
      const approvalUrl = order.links.find((link) => link.rel === "approve")?.href;
      if (approvalUrl && !isPayPalSandboxApprovalUrl(approvalUrl)) {
        throw new Error("PayPal Sandbox returned an unsupported approval URL.");
      }
      if (assessment.decision === "ALLOW" && !approvalUrl) {
        throw new Error("PayPal Sandbox did not return an approval link.");
      }
      const status = assessment.decision === "ALLOW"
        ? "APPROVED"
        : assessment.decision === "REVIEW" ? "REVIEW_REQUIRED" : "BLOCKED";

      const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, status: "RISK_PENDING", paypalOrderId: null, riskAssessmentSnapshot: null },
        {
          $set: {
            paypalOrderId: order.id,
            status,
            riskScore: assessment.score,
            riskDecision: assessment.decision,
            riskFindings: assessment.findings,
            riskAssessmentSnapshot: snapshot,
            orderLeaseUntil: null,
            failureCode: null,
            failureMessage: null,
          },
        },
        { new: true }
      );
      return { ...serializePayment(updated), ...(status === "APPROVED" ? { approvalUrl } : {}) };
    } catch (error) {
      await Payment.updateOne(
        { _id: payment._id, status: "RISK_PENDING", paypalOrderId: null },
        {
          $set: {
            status: "CREATED",
            orderLeaseUntil: null,
            failureCode: error?.code === "PAYPAL_API_REJECTED" ? "PAYPAL_ORDER_REJECTED" : "PAYMENT_SETUP_FAILED",
            failureMessage: "Payment setup did not complete. Retry with the same idempotency key.",
          },
        }
      );
      throw error?.status ? error : httpError(502, "PAYPAL_UNAVAILABLE", "PayPal Sandbox could not prepare this payment. Retry with the same idempotency key.");
    }
  }

  async function getPayment({ buyerId, paymentId }) {
    const payment = await Payment.findOne({ paymentId, buyerId }).lean();
    if (!payment) throw httpError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    return serializePayment(payment);
  }

  async function listPayments({ buyerId }) {
    const payments = await Payment.find({ buyerId }).sort({ createdAt: -1 }).limit(100).lean();
    return payments.map(serializePayment);
  }

  async function listReviewQueue() {
    const payments = await Payment.find({ status: "REVIEW_REQUIRED" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return payments.map((payment) => ({
      paymentId: payment.paymentId,
      sellerId: payment.sellerId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      riskDecision: payment.riskDecision,
      riskScore: payment.riskScore,
      riskFindings: payment.riskFindings,
      riskAssessmentSnapshot: payment.riskAssessmentSnapshot,
      createdAt: payment.createdAt,
    }));
  }

  async function capturePayment({ buyerId, paymentId }) {
    let payment = await Payment.findOne({ paymentId, buyerId });
    if (!payment) throw httpError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    if (payment.riskDecision !== "ALLOW" || payment.riskAssessmentSnapshot?.decision !== "ALLOW" || !payment.paypalOrderId || payment.status === "REVIEW_REQUIRED") {
      throw httpError(409, "CAPTURE_NOT_ALLOWED", "Capture is disabled unless the stored risk decision is ALLOW.");
    }
    if (payment.status === "COMPLETED") return serializePayment(payment);
    if (payment.status !== "APPROVED" && !( ["CAPTURE_PENDING", "CAPTURE_UNCERTAIN"].includes(payment.status) && payment.captureLeaseUntil <= new Date())) {
      throw httpError(409, "INVALID_PAYMENT_STATE", "Payment is not ready for capture.");
    }
    const claimed = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        riskDecision: "ALLOW",
        $or: [
          { status: "APPROVED" },
          { status: { $in: ["CAPTURE_PENDING", "CAPTURE_UNCERTAIN"] }, captureLeaseUntil: { $lte: new Date() } },
        ],
      },
      { $set: { status: "CAPTURE_PENDING", captureLeaseUntil: new Date(Date.now() + CAPTURE_LEASE_MS) } },
      { new: true }
    );
    if (!claimed) throw httpError(409, "CAPTURE_IN_PROGRESS", "Capture is already in progress or the payment state changed.");

    try {
      const order = await paypal.getOrder(claimed.paypalOrderId);
      assertOrderMatchesPayment(order, claimed);
      if (order.status === "COMPLETED") {
        const alreadyCaptured = findCompletedCapture(order, claimed);
        if (!alreadyCaptured) throw httpError(409, "ORDER_MISMATCH", "Completed PayPal order capture does not match the stored payment.");
        const completed = await Payment.findOneAndUpdate(
          { _id: claimed._id, status: "CAPTURE_PENDING", riskDecision: "ALLOW" },
          { $set: { status: "COMPLETED", paypalCaptureId: alreadyCaptured.id, captureLeaseUntil: null } },
          { new: true }
        );
        if (!completed) throw new Error("Payment state changed before verified capture could be recorded.");
        return serializePayment(completed);
      }
      if (order.status !== "APPROVED") {
        throw httpError(409, "ORDER_NOT_APPROVED", "PayPal has not confirmed buyer approval for this order.");
      }
      const currentSeller = await Seller.findOne({ sellerId: claimed.sellerId }).select("riskStatus").lean();
      if (!currentSeller || currentSeller.riskStatus === "FLAGGED") {
        await Payment.updateOne(
          { _id: claimed._id, status: "CAPTURE_PENDING" },
          { $set: { status: "REVIEW_REQUIRED", captureLeaseUntil: null, failureCode: "SELLER_RISK_CHANGED", failureMessage: "Seller risk status changed; capture requires a new payment and risk assessment." } }
        );
        throw httpError(409, "SELLER_RISK_CHANGED", "Seller risk status changed; capture is blocked until a new risk assessment is available.");
      }
      const captured = await paypal.captureOrder(claimed.paypalOrderId, `tm-cap-${claimed.paymentId}`);
      const capture = findCompletedCapture(captured, claimed);
      if (!capture) {
        throw new Error("PayPal Sandbox capture response could not be verified.");
      }
      const completed = await Payment.findOneAndUpdate(
        { _id: claimed._id, status: "CAPTURE_PENDING", riskDecision: "ALLOW" },
        { $set: { status: "COMPLETED", paypalCaptureId: capture.id, captureLeaseUntil: null, failureCode: null, failureMessage: null } },
        { new: true }
      );
      if (!completed) throw new Error("Payment state changed before verified capture could be recorded.");
      return serializePayment(completed);
    } catch (error) {
      if (error?.code === "ORDER_NOT_APPROVED") {
        await Payment.updateOne({ _id: claimed._id, status: "CAPTURE_PENDING" }, { $set: { status: "APPROVED", captureLeaseUntil: null } });
      }
      if (error?.code === "ORDER_MISMATCH") {
        await Payment.updateOne(
          { _id: claimed._id, status: "CAPTURE_PENDING" },
          { $set: { status: "FAILED", captureLeaseUntil: null, failureCode: "PAYPAL_ORDER_MISMATCH", failureMessage: "PayPal order details did not match the stored payment." } }
        );
      }
      if (!["ORDER_NOT_APPROVED", "ORDER_MISMATCH", "SELLER_RISK_CHANGED"].includes(error?.code)) {
        await Payment.updateOne(
          { _id: claimed._id, status: "CAPTURE_PENDING" },
          { $set: { status: "CAPTURE_UNCERTAIN", failureCode: "CAPTURE_UNCONFIRMED", failureMessage: "PayPal capture outcome is uncertain; reconcile with PayPal before retrying." } }
        );
      }
      // Uncertain attempts retain a lease. Retry after expiry retrieves PayPal's order first and
      // reuses the same PayPal-Request-Id if capture is still needed.
      throw error?.status ? error : httpError(502, "CAPTURE_UNCONFIRMED", "Capture could not be confirmed. Check payment status before retrying.");
    }
  }

  async function cancelPayment({ buyerId, paymentId }) {
    const payment = await Payment.findOne({ paymentId, buyerId });
    if (!payment) throw httpError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    if (!["CREATED", "APPROVED", "REVIEW_REQUIRED"].includes(payment.status)) {
      throw httpError(409, "INVALID_PAYMENT_STATE", "Payment cannot be cancelled in its current state.");
    }
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: payment.status, paypalCaptureId: null },
      { $set: { status: "CANCELLED", orderLeaseUntil: null } },
      { new: true }
    );
    if (!updated) throw httpError(409, "INVALID_PAYMENT_STATE", "Payment state changed; refresh and retry.");
    return serializePayment(updated);
  }

  async function processWebhook({ headers, event, onVerificationResult }) {
    if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
      throw httpError(400, "INVALID_WEBHOOK", "Invalid PayPal webhook event.");
    }
    const verified = await paypal.verifyWebhook(headers, event);
    onVerificationResult?.(verified);
    if (!verified) throw httpError(401, "INVALID_WEBHOOK_SIGNATURE", "PayPal webhook signature verification failed.");
    if (await PayPalWebhookEvent.exists({ eventId: event.id })) {
      return { received: true, duplicate: true };
    }
    const resource = event.resource || {};
    const relatedOrderId = resource.supplementary_data?.related_ids?.order_id;
    const relatedCaptureId = resource.supplementary_data?.related_ids?.capture_id ||
      (["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REVERSED"].includes(event.event_type) ? resource.id : null);
    const paymentQuery = [];
    if (relatedOrderId) paymentQuery.push({ paypalOrderId: relatedOrderId });
    if (relatedCaptureId) paymentQuery.push({ paypalCaptureId: relatedCaptureId });
    const payment = paymentQuery.length ? await Payment.findOne({ $or: paymentQuery }).lean() : null;
    let captureId = null;
    let verifiedRefund = null;
    let verifiedReversal = false;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && payment) {
      const order = await paypal.getOrder(payment.paypalOrderId);
      assertOrderMatchesPayment(order, payment);
      const capture = resource;
      if (capture.status !== "COMPLETED" || capture.amount?.value !== payment.amount || capture.amount?.currency_code !== payment.currency) {
        throw httpError(400, "WEBHOOK_PAYMENT_MISMATCH", "PayPal webhook does not match the stored payment.");
      }
      if (typeof capture.id !== "string" || !capture.id) throw httpError(400, "INVALID_WEBHOOK", "PayPal capture event is missing its capture ID.");
      const associatedCapture = order.purchase_units.flatMap((unit) => unit.payments?.captures || [])
        .find((item) => item.id === capture.id && item.amount?.value === payment.amount && item.amount?.currency_code === payment.currency);
      if (!associatedCapture) {
        throw httpError(400, "WEBHOOK_PAYMENT_MISMATCH", "PayPal order does not confirm the webhook capture.");
      }
      // A delayed COMPLETED event may arrive after PayPal's authoritative order now reports a
      // reversal. Validate the association but do not let the stale event change the state.
      if (associatedCapture.status === "COMPLETED" && order.status === "COMPLETED") captureId = associatedCapture.id;
    }
    if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" && payment) {
      const refundId = resource.id;
      if (typeof refundId !== "string" || !refundId) throw httpError(400, "INVALID_WEBHOOK", "PayPal refund event is missing its refund ID.");
      const order = await paypal.getOrder(payment.paypalOrderId);
      assertOrderMatchesPayment(order, payment);
      const refund = await paypal.getRefund(refundId);
      const captureHref = refund.links?.find((link) => link.rel === "up")?.href;
      const upstreamCaptureId = typeof captureHref === "string" ? captureHref.split("/").at(-1) : null;
      const associatedCapture = order.purchase_units.flatMap((unit) => unit.payments?.captures || [])
        .find((item) => item.id === upstreamCaptureId && item.amount?.value === payment.amount &&
          item.amount?.currency_code === payment.currency && ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(item.status));
      if (refund.id !== refundId || refund.status !== "COMPLETED" ||
          refund.amount?.currency_code !== payment.currency ||
          resource.status !== "COMPLETED" ||
          resource.amount?.currency_code !== refund.amount.currency_code ||
          resource.amount?.value !== refund.amount.value ||
          !/^\d{1,8}\.\d{2}$/.test(refund.amount?.value || "") ||
          toMinorUnits(refund.amount.value) > toMinorUnits(payment.amount) ||
          !associatedCapture ||
          (payment.paypalCaptureId && upstreamCaptureId !== payment.paypalCaptureId)) {
        throw httpError(400, "WEBHOOK_PAYMENT_MISMATCH", "PayPal refund does not match the stored payment.");
      }
      verifiedRefund = { refundId, amount: refund.amount.value, currency: refund.amount.currency_code, status: "COMPLETED", captureId: upstreamCaptureId };
    }
    if (event.event_type === "PAYMENT.CAPTURE.REVERSED" && payment) {
      const order = await paypal.getOrder(payment.paypalOrderId);
      assertOrderMatchesPayment(order, payment);
      const reversedCapture = order.purchase_units.flatMap((unit) => unit.payments?.captures || [])
        .find((item) => item.id === resource.id && item.status === "REVERSED" && item.amount?.value === payment.amount && item.amount?.currency_code === payment.currency);
      if (!resource.id || (payment.paypalCaptureId && resource.id !== payment.paypalCaptureId) || !reversedCapture) {
        throw httpError(400, "WEBHOOK_PAYMENT_MISMATCH", "PayPal reversal does not match the stored capture.");
      }
      verifiedReversal = true;
    }

    const session = await mongoose.startSession();
    let duplicate = false;
    try {
      duplicate = Boolean(await PayPalWebhookEvent.exists({ eventId: event.id }));
      if (duplicate) return { received: true, duplicate: true };
      try {
        await session.withTransaction(async () => {
          await PayPalWebhookEvent.create([{
            eventId: event.id,
            eventType: event.event_type,
            resourceId: typeof resource.id === "string" ? resource.id : null,
            paymentId: payment?.paymentId || null,
            processed: true,
          }], { session });
          if (captureId && payment) {
            await Payment.updateOne(
              { _id: payment._id, status: { $in: ["CAPTURE_PENDING", "CAPTURE_UNCERTAIN"] }, riskDecision: "ALLOW", "riskAssessmentSnapshot.decision": "ALLOW", paypalCaptureId: null },
              { $set: { status: "COMPLETED", paypalCaptureId: captureId, captureLeaseUntil: null } },
              { session }
            );
          }
          if (verifiedReversal && payment) {
            await Payment.updateOne(
              { _id: payment._id, status: { $in: ["COMPLETED", "CAPTURE_PENDING", "CAPTURE_UNCERTAIN"] }, $or: [{ paypalCaptureId: resource.id }, { paypalCaptureId: null }] },
              { $set: { status: "REVERSED", paypalCaptureId: resource.id, captureLeaseUntil: null, failureCode: "PAYPAL_CAPTURE_REVERSED", failureMessage: "PayPal reported that this capture was reversed." } },
              { session }
            );
          }
          if (verifiedRefund && payment) {
            const current = await Payment.findOne({ _id: payment._id }).session(session);
            if (current && ["COMPLETED", "CAPTURE_PENDING", "CAPTURE_UNCERTAIN"].includes(current.status) &&
                (!current.paypalCaptureId || current.paypalCaptureId === verifiedRefund.captureId) &&
                !current.refunds.some((refund) => refund.refundId === verifiedRefund.refundId)) {
              current.paypalCaptureId = current.paypalCaptureId || verifiedRefund.captureId;
              if (["CAPTURE_PENDING", "CAPTURE_UNCERTAIN"].includes(current.status)) current.status = "COMPLETED";
              current.refunds.push(verifiedRefund);
              const refundedMinor = current.refunds.reduce((sum, refund) => sum + toMinorUnits(refund.amount), 0n);
              if (refundedMinor > toMinorUnits(current.amount)) {
                throw httpError(400, "WEBHOOK_REFUND_OVERFLOW", "Verified PayPal refunds exceed the stored payment amount.");
              }
              if (refundedMinor >= toMinorUnits(current.amount)) current.status = "REFUNDED";
              await current.save({ session });
            }
          }
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        duplicate = true;
      }
    } finally {
      await session.endSession();
    }
    return { received: true, duplicate };
  }

  return { createPayment, getPayment, listPayments, listReviewQueue, capturePayment, cancelPayment, processWebhook };
}

function assertOrderMatchesPayment(order, payment) {
  const unit = order?.purchase_units?.find((item) =>
    item.custom_id === payment.paymentId && item.reference_id === payment.paymentId
  );
  if (!order || order.id !== payment.paypalOrderId || order.intent !== "CAPTURE" || !unit ||
      unit.amount?.value !== payment.amount || unit.amount?.currency_code !== payment.currency) {
    throw httpError(409, "ORDER_MISMATCH", "PayPal order details do not match the stored payment.");
  }
}

function findCompletedCapture(order, payment) {
  if (order?.status !== "COMPLETED" || !Array.isArray(order.purchase_units)) return null;
  for (const unit of order.purchase_units) {
    if (unit.custom_id !== payment.paymentId || unit.reference_id !== payment.paymentId ||
        unit.amount?.value !== payment.amount || unit.amount?.currency_code !== payment.currency) continue;
    const capture = unit.payments?.captures?.find((item) =>
      item.status === "COMPLETED" && item.amount?.value === payment.amount && item.amount?.currency_code === payment.currency
    );
    if (capture) return capture;
  }
  return null;
}

function serializePayment(payment) {
  if (!payment) return null;
  const data = typeof payment.toObject === "function" ? payment.toObject() : payment;
  return {
    paymentId: data.paymentId,
    paypalOrderId: data.paypalOrderId,
    paypalCaptureId: data.paypalCaptureId,
    refunds: data.refunds || [],
    captureRetryAt: data.captureLeaseUntil || null,
    sellerId: data.sellerId,
    amount: data.amount,
    currency: data.currency,
    status: data.status,
    riskScore: data.riskScore,
    riskDecision: data.riskDecision,
    riskFindings: data.riskFindings || [],
    riskAssessmentSnapshot: data.riskAssessmentSnapshot,
    failureCode: data.failureCode,
    failureMessage: data.failureMessage,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function frontendBaseUrl() {
  const value = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) throw new Error();
    return url.origin;
  } catch {
    throw httpError(503, "INVALID_FRONTEND_URL", "FRONTEND_BASE_URL must use HTTPS except for localhost development.");
  }
}

function isPayPalSandboxApprovalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

function toMinorUnits(value) {
  return decimalToMinorUnits(String(value), 2);
}

function decimalToMinorUnits(value, exponent) {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${exponent}}))?$`).exec(value);
  if (!match) throw httpError(400, "INVALID_AMOUNT", "Amount must use the supported currency precision.");
  return BigInt(match[1]) * (10n ** BigInt(exponent)) + BigInt((match[2] || "").padEnd(exponent, "0") || "0");
}

function minorUnitsToDecimal(value, exponent) {
  const scale = 10n ** BigInt(exponent);
  return `${value / scale}.${String(value % scale).padStart(exponent, "0")}`;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export const paymentService = createPaymentService();

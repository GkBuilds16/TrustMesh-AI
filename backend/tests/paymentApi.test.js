import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { disconnectTestDatabase } from "./testDatabaseLifecycle.js";
import User from "../models/User.js";
import Seller from "../models/Seller.js";
import Payment from "../models/Payment.js";
import PayPalWebhookEvent from "../models/PayPalWebhookEvent.js";
import { createPaymentService } from "../services/paymentService.js";

const sellerPrefix = "payment-api-";
let buyerA;
let buyerB;
let buyerC;
let server;
let baseUrl;
let service;
let orderRequests;
let captureRequests;
let failNextOrder;
let orderStatus;
let holdGetOrder;
let releaseGetOrder;
let failNextCaptureAfterProcessing;
const knownOrders = new Map();
let refundResponse;

const paypal = {
  async createOrder(payload, requestId) {
    orderRequests++;
    if (failNextOrder) {
      failNextOrder = false;
      const error = new Error("simulated PayPal outage");
      error.code = "PAYPAL_API_REJECTED";
      error.status = 502;
      throw error;
    }
    const paymentId = payload.purchase_units[0].custom_id;
    const id = `ORDER-${paymentId}`;
    knownOrders.set(id, {
      id,
      requestId,
      intent: payload.intent,
      status: orderStatus,
      purchase_units: payload.purchase_units,
      links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
    });
    return knownOrders.get(id);
  },
  async getOrder(orderId) {
    if (holdGetOrder) await new Promise((resolve) => { releaseGetOrder = resolve; });
    const order = knownOrders.get(orderId);
    if (!order) throw new Error("missing fake test order");
    return { ...order };
  },
  async captureOrder(orderId, requestId) {
    captureRequests++;
    const order = knownOrders.get(orderId);
    const unit = order.purchase_units[0];
    order.status = "COMPLETED";
    order.purchase_units = [{ ...unit, payments: { captures: [{
      id: `CAP-${orderId}`,
      status: "COMPLETED",
      amount: unit.amount,
      requestId,
    }] } }];
    if (failNextCaptureAfterProcessing) {
      failNextCaptureAfterProcessing = false;
      throw new Error("simulated lost capture response");
    }
    return { ...order };
  },
  async getRefund() { return refundResponse; },
  async verifyWebhook() { return webhookSignatureValid; },
};
let webhookSignatureValid = true;

function tokenFor(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "10m",
    issuer: "trustmesh-ai",
    audience: "trustmesh-ai-app",
  });
}

async function api(path, { user = buyerA, token, method = "GET", body, idempotencyKey } = {}) {
  const headers = {};
  if (user && !token) headers.Authorization = `Bearer ${tokenFor(user)}`;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

function createBody(sellerId, amount = "12.50", currency = "USD") {
  return { sellerId, amount, currency };
}

test.before(async () => {
  if (!process.env.JWT_SECRET) throw new Error("Configure JWT_SECRET in backend/.env.test");
  const previousUsers = await User.find({ email: { $in: ["payment-test-a@example.com", "payment-test-b@example.com", "payment-test-rate@example.com"] } }).select("_id").lean();
  const previousBuyerIds = previousUsers.map((user) => user._id);
  const previousPayments = await Payment.find({ buyerId: { $in: previousBuyerIds } }).select("paymentId").lean();
  await PayPalWebhookEvent.deleteMany({ paymentId: { $in: previousPayments.map((payment) => payment.paymentId) } });
  await Payment.deleteMany({ buyerId: { $in: previousBuyerIds } });
  await User.deleteMany({ _id: { $in: previousBuyerIds } });
  await Seller.deleteMany({ sellerId: { $regex: `^${sellerPrefix}` } });
  buyerA = await User.create({
    name: "Payment Test Buyer A",
    email: "payment-test-a@example.com",
    passwordHash: await bcrypt.hash("PaymentTestPassword!2026", 12),
    role: "ANALYST",
  });
  buyerB = await User.create({
    name: "Payment Test Buyer B",
    email: "payment-test-b@example.com",
    passwordHash: await bcrypt.hash("PaymentTestPassword!2026", 12),
    role: "ANALYST",
  });
  buyerC = await User.create({
    name: "Payment Rate Test Analyst",
    email: "payment-test-rate@example.com",
    passwordHash: await bcrypt.hash("PaymentTestPassword!2026", 12),
    role: "ANALYST",
  });
  service = createPaymentService({ paypal });
  orderRequests = 0;
  captureRequests = 0;
  failNextOrder = false;
  orderStatus = "APPROVED";
  holdGetOrder = false;
  failNextCaptureAfterProcessing = false;
  webhookSignatureValid = true;
  refundResponse = null;
  server = createApp({ payments: service }).listen(0, "127.0.0.1");
  baseUrl = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
});

test("requires authentication and a valid seller, amount, currency, and idempotency key", async () => {
  const unauthenticated = await api("/api/payments", { user: null, method: "POST", body: createBody("missing"), idempotencyKey: "payment-test-unauth" });
  assert.equal(unauthenticated.response.status, 401);

  const missingSeller = await api("/api/payments", { method: "POST", body: createBody("missing-payment-seller"), idempotencyKey: "payment-test-seller" });
  assert.equal(missingSeller.response.status, 404);

  const sellerId = await addSeller("invalids");
  const invalidAmount = await api("/api/payments", { method: "POST", body: createBody(sellerId, "0"), idempotencyKey: "payment-test-amount" });
  assert.equal(invalidAmount.response.status, 400);
  const excessiveAmount = await api("/api/payments", { method: "POST", body: createBody(sellerId, "10000.01"), idempotencyKey: "payment-test-excessive" });
  assert.equal(excessiveAmount.response.status, 400);
  const invalidCurrency = await api("/api/payments", { method: "POST", body: createBody(sellerId, "1.00", "CAD"), idempotencyKey: "payment-test-currency" });
  assert.equal(invalidCurrency.response.status, 400);
  const missingKey = await api("/api/payments", { method: "POST", body: createBody(sellerId) });
  assert.equal(missingKey.response.status, 400);
});

test("creates an ALLOW payment with server-derived risk snapshot and Sandbox approval URL", async () => {
  const sellerId = await addSeller("allow", { verificationStatus: "VERIFIED" });
  const { response, data } = await api("/api/payments", {
    method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-allow",
  });
  assert.equal(response.status, 200);
  assert.equal(data.payment.status, "APPROVED");
  assert.equal(data.payment.riskDecision, "ALLOW");
  assert.equal(data.payment.amount, "12.50");
  assert.match(data.payment.approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal(data.payment.riskAssessmentSnapshot.evidenceAvailability.buyerTransactionVelocity, "UNAVAILABLE_NO_PAYMENT_HISTORY");
  assert.equal(data.payment.riskAssessmentSnapshot.evidenceAvailability.unusualAmountBaseline, "UNAVAILABLE_NO_BUYER_BASELINE");
  assert.equal(data.payment.riskAssessmentSnapshot.evidenceAvailability.buyerTransactionVelocity.startsWith("UNAVAILABLE"), true);
});

test("idempotency returns the existing payment and rejects a conflicting reuse", async () => {
  const sellerId = await addSeller("idempotent", { verificationStatus: "VERIFIED" });
  const key = "payment-test-idempotent";
  const first = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: key });
  const countAfterFirst = orderRequests;
  const repeat = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: key });
  assert.equal(repeat.data.payment.paymentId, first.data.payment.paymentId);
  assert.equal(orderRequests, countAfterFirst);
  const conflict = await api("/api/payments", { method: "POST", body: createBody(sellerId, "13.00"), idempotencyKey: key });
  assert.equal(conflict.response.status, 409);
});

test("concurrent payment creation with one buyer-scoped key creates one internal record and provider order", async () => {
  const sellerId = await addSeller("concurrent-create", { verificationStatus: "VERIFIED" });
  const key = "payment-test-concurrent-create";
  const before = orderRequests;
  const results = await Promise.all([
    api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: key }),
    api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: key }),
  ]);
  assert.equal(results[0].response.status, 200);
  assert.equal(results[1].response.status, 200);
  assert.equal(results[0].data.payment.paymentId, results[1].data.payment.paymentId);
  assert.equal(await Payment.countDocuments({ buyerId: buyerA._id, idempotencyKey: key }), 1);
  assert.equal(orderRequests - before, 1);
});

test("retries a PayPal order failure with the same idempotency key", async () => {
  const sellerId = await addSeller("retry", { verificationStatus: "VERIFIED" });
  failNextOrder = true;
  const first = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-retry" });
  assert.equal(first.response.status, 502);
  const retry = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-retry" });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.payment.status, "APPROVED");
});

test("REVIEW network evidence does not return an approval URL or allow capture", async () => {
  const sharedBeneficiary = "payment-shared-beneficiary-review";
  const sellerId = await addSeller("review-target", { beneficiaryIds: [sharedBeneficiary], verificationStatus: "VERIFIED" });
  await addSeller("review-flagged", { beneficiaryIds: [sharedBeneficiary], riskStatus: "FLAGGED", verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-review" });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.payment.status, "REVIEW_REQUIRED");
  assert.equal(created.data.payment.riskDecision, "REVIEW");
  assert.equal("approvalUrl" in created.data.payment, false);
  const capture = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(capture.response.status, 409);
  assert.equal(capture.data.message, "Capture is disabled unless the stored risk decision is ALLOW.");
  const queue = await api("/api/payments/review-queue", { user: buyerB });
  const queued = queue.data.payments.find((item) => item.paymentId === created.data.payment.paymentId);
  assert.equal(queue.response.status, 200);
  assert.equal(queued.status, "REVIEW_REQUIRED");
  assert.equal("buyerId" in queued, false);
});

test("a flagged target is BLOCKED as target evidence, not mislabeled as a flagged network connection", async () => {
  const sellerId = await addSeller("blocked-target", { riskStatus: "FLAGGED", verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-block" });
  assert.equal(created.data.payment.status, "BLOCKED");
  assert.equal(created.data.payment.riskDecision, "BLOCK");
  assert.equal(created.data.payment.riskAssessmentSnapshot.graph.riskSignals.length, 0);
  assert.deepEqual(created.data.payment.riskFindings.map((finding) => finding.rule), ["FLAGGED_SELLER"]);
  assert.equal("approvalUrl" in created.data.payment, false);
  const capture = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(capture.response.status, 409);
  assert.equal(captureRequests, 0);
});

test("only the buyer can read a payment and a verified ALLOW order can be captured", async () => {
  const sellerId = await addSeller("capture", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-capture" });
  const paymentId = created.data.payment.paymentId;
  const denied = await api(`/api/payments/${paymentId}`, { user: buyerB });
  assert.equal(denied.response.status, 404);
  const result = await api(`/api/payments/${paymentId}/capture`, { method: "POST" });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.payment.status, "COMPLETED");
  assert.ok(result.data.payment.paypalCaptureId);
  assert.equal(captureRequests, 1);
  const repeated = await api(`/api/payments/${paymentId}/capture`, { method: "POST" });
  assert.equal(repeated.data.payment.status, "COMPLETED");
  assert.equal(captureRequests, 1);
});

test("does not capture until PayPal confirms the stored order is APPROVED", async () => {
  const sellerId = await addSeller("not-approved", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-not-approved" });
  const order = knownOrders.get(created.data.payment.paypalOrderId);
  order.status = "CREATED";
  const count = captureRequests;
  const result = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(result.response.status, 409);
  assert.equal(captureRequests, count);
  assert.equal((await Payment.findOne({ paymentId: created.data.payment.paymentId })).status, "APPROVED");
});

test("rejects a mismatched PayPal order before capture", async () => {
  const sellerId = await addSeller("mismatch", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-mismatch" });
  const order = knownOrders.get(created.data.payment.paypalOrderId);
  order.purchase_units[0].amount.value = "999.00";
  const response = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(response.response.status, 409);
  assert.equal(captureRequests, 1);
  assert.equal((await Payment.findOne({ paymentId: created.data.payment.paymentId })).status, "FAILED");
});

test("concurrent capture requests cannot both call PayPal", async () => {
  const sellerId = await addSeller("concurrent", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-concurrent" });
  holdGetOrder = true;
  const firstPromise = api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  while (!releaseGetOrder) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(second.response.status, 409);
  releaseGetOrder();
  const first = await firstPromise;
  holdGetOrder = false;
  assert.equal(first.response.status, 200);
  assert.equal(captureRequests, 2); // one prior successful capture plus this one
});

test("recovers an ambiguous capture by verifying completed PayPal order without capturing twice", async () => {
  const sellerId = await addSeller("ambiguous", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-ambiguous" });
  const paymentId = created.data.payment.paymentId;
  failNextCaptureAfterProcessing = true;
  const first = await api(`/api/payments/${paymentId}/capture`, { method: "POST" });
  assert.equal(first.response.status, 502);
  assert.equal((await Payment.findOne({ paymentId })).status, "CAPTURE_UNCERTAIN");
  await Payment.updateOne({ paymentId }, { $set: { captureLeaseUntil: new Date(0) } });
  const count = captureRequests;
  const retry = await api(`/api/payments/${paymentId}/capture`, { method: "POST" });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.payment.status, "COMPLETED");
  assert.equal(captureRequests, count);
});

test("rejects an invalid webhook signature and processes verified events idempotently", async () => {
  const sellerId = await addSeller("webhook", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-webhook" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  await Payment.updateOne({ _id: payment._id }, { $set: { status: "CAPTURE_PENDING" } });
  const order = knownOrders.get(payment.paypalOrderId);
  const webhookCaptureId = `CAP-${payment.paypalOrderId}`;
  order.status = "COMPLETED";
  order.purchase_units = [{ ...order.purchase_units[0], payments: { captures: [{
    id: webhookCaptureId,
    status: "COMPLETED",
    amount: order.purchase_units[0].amount,
  }] } }];
  orderStatus = "COMPLETED";
  const event = {
    id: "PAYMENT-TEST-WEBHOOK-EVENT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: webhookCaptureId,
      status: "COMPLETED",
      amount: { value: payment.amount, currency_code: payment.currency },
      supplementary_data: { related_ids: { order_id: payment.paypalOrderId } },
    },
  };
  webhookSignatureValid = false;
  const invalid = await api("/api/webhooks/paypal", { method: "POST", body: event });
  assert.equal(invalid.response.status, 401);
  assert.equal(await PayPalWebhookEvent.countDocuments({ eventId: event.id }), 0);

  webhookSignatureValid = true;
  const accepted = await api("/api/webhooks/paypal", { method: "POST", body: event });
  assert.equal(accepted.response.status, 200);
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "COMPLETED");
  const repeated = await api("/api/webhooks/paypal", { method: "POST", body: event });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.data.duplicate, true);
  assert.equal(await PayPalWebhookEvent.countDocuments({ eventId: event.id }), 1);
  orderStatus = "APPROVED";
});

test("marks a payment REFUNDED only after PayPal verifies the associated completed refund", async () => {
  const sellerId = await addSeller("refund", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-refund" });
  const completed = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  const refundId = "REFUND-TEST-1";
  refundResponse = {
    id: refundId,
    status: "COMPLETED",
    amount: { value: payment.amount, currency_code: payment.currency },
    links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${payment.paypalCaptureId}` }],
  };
  const event = {
    id: "PAYMENT-TEST-REFUND-EVENT-1",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: refundId,
      status: "COMPLETED",
      amount: { value: payment.amount, currency_code: payment.currency },
      supplementary_data: { related_ids: { order_id: payment.paypalOrderId } },
    },
  };
  const result = await api("/api/webhooks/paypal", { method: "POST", body: event });
  assert.equal(result.response.status, 200);
  const refunded = await Payment.findOne({ paymentId: payment.paymentId });
  assert.equal(refunded.status, "REFUNDED");
  assert.equal(refunded.refunds.length, 1);
  assert.equal(refunded.refunds[0].refundId, refundId);
  assert.equal(completed.data.payment.status, "COMPLETED");
});

test("rejects a verified refund that PayPal does not associate with this order's capture", async () => {
  const sellerId = await addSeller("refund-wrong-capture", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-refund-wrong-capture" });
  await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  const refundId = "REFUND-TEST-WRONG-CAPTURE";
  refundResponse = {
    id: refundId,
    status: "COMPLETED",
    amount: { value: payment.amount, currency_code: payment.currency },
    links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/UNRELATED-CAPTURE" }],
  };
  const result = await api("/api/webhooks/paypal", { method: "POST", body: {
    id: "PAYMENT-TEST-REFUND-WRONG-CAPTURE-EVENT",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { id: refundId, status: "COMPLETED", amount: { value: payment.amount, currency_code: payment.currency }, supplementary_data: { related_ids: { order_id: payment.paypalOrderId } } },
  } });
  assert.equal(result.response.status, 400);
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "COMPLETED");
  assert.equal(await PayPalWebhookEvent.exists({ eventId: "PAYMENT-TEST-REFUND-WRONG-CAPTURE-EVENT" }), null);
});

test("accepts a signed capture reversal only when it matches the stored PayPal capture", async () => {
  const sellerId = await addSeller("reversal", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-reversal" });
  const captured = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  const order = knownOrders.get(payment.paypalOrderId);
  order.purchase_units[0].payments.captures[0].status = "REVERSED";
  const event = {
    id: "PAYMENT-TEST-REVERSAL-EVENT-1",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource: {
      id: payment.paypalCaptureId,
      supplementary_data: { related_ids: { order_id: payment.paypalOrderId } },
    },
  };
  const result = await api("/api/webhooks/paypal", { method: "POST", body: event });
  assert.equal(result.response.status, 200);
  assert.equal(captured.data.payment.status, "COMPLETED");
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "REVERSED");
});

test("reconciles a reversal delivered before capture completion and ignores the delayed completion", async () => {
  const sellerId = await addSeller("out-of-order-reversal", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-out-of-order-reversal" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  await Payment.updateOne({ _id: payment._id }, { $set: { status: "CAPTURE_PENDING" } });
  const order = knownOrders.get(payment.paypalOrderId);
  const captureId = `CAP-${payment.paypalOrderId}`;
  order.status = "COMPLETED";
  order.purchase_units = [{ ...order.purchase_units[0], payments: { captures: [{
    id: captureId,
    status: "REVERSED",
    amount: order.purchase_units[0].amount,
  }] } }];

  const reversal = {
    id: "PAYMENT-TEST-OUT-OF-ORDER-REVERSAL",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource: { id: captureId, supplementary_data: { related_ids: { order_id: payment.paypalOrderId } } },
  };
  const reversed = await api("/api/webhooks/paypal", { method: "POST", body: reversal });
  assert.equal(reversed.response.status, 200);
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "REVERSED");

  const completion = {
    id: "PAYMENT-TEST-DELAYED-COMPLETION-AFTER-REVERSAL",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      status: "COMPLETED",
      amount: { value: payment.amount, currency_code: payment.currency },
      supplementary_data: { related_ids: { order_id: payment.paypalOrderId } },
    },
  };
  const delayed = await api("/api/webhooks/paypal", { method: "POST", body: completion });
  assert.equal(delayed.response.status, 200);
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "REVERSED");
  const duplicate = await api("/api/webhooks/paypal", { method: "POST", body: reversal });
  assert.equal(duplicate.data.duplicate, true);
});

test("a delayed capture completion cannot regress a fully refunded payment", async () => {
  const sellerId = await addSeller("delayed-completion-refund", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-delayed-completion-refund" });
  const captureResult = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  const payment = await Payment.findOne({ paymentId: created.data.payment.paymentId });
  const refundId = "REFUND-TEST-DELAYED-COMPLETION";
  refundResponse = {
    id: refundId,
    status: "COMPLETED",
    amount: { value: payment.amount, currency_code: payment.currency },
    links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${payment.paypalCaptureId}` }],
  };
  const refund = await api("/api/webhooks/paypal", { method: "POST", body: {
    id: "PAYMENT-TEST-REFUND-BEFORE-DELAYED-CAPTURE",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { id: refundId, status: "COMPLETED", amount: { value: payment.amount, currency_code: payment.currency }, supplementary_data: { related_ids: { capture_id: payment.paypalCaptureId } } },
  } });
  assert.equal(refund.response.status, 200);
  const delayed = await api("/api/webhooks/paypal", { method: "POST", body: {
    id: "PAYMENT-TEST-CAPTURE-AFTER-FULL-REFUND",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: payment.paypalCaptureId, status: "COMPLETED", amount: { value: payment.amount, currency_code: payment.currency }, supplementary_data: { related_ids: { order_id: payment.paypalOrderId } } },
  } });
  assert.equal(delayed.response.status, 200);
  assert.equal((await Payment.findOne({ paymentId: payment.paymentId })).status, "REFUNDED");
  assert.equal(captureResult.data.payment.status, "COMPLETED");
});

test("blocks capture if the seller becomes flagged after risk assessment", async () => {
  const sellerId = await addSeller("flagged-after-assessment", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-flagged-after-assessment" });
  await Seller.updateOne({ sellerId }, { $set: { riskStatus: "FLAGGED" } });
  const before = captureRequests;
  const result = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(result.response.status, 409);
  assert.match(result.data.message, /seller risk status changed/i);
  assert.equal(captureRequests, before);
  assert.equal((await Payment.findOne({ paymentId: created.data.payment.paymentId })).status, "REVIEW_REQUIRED");
});

test("normalizes supported decimal amounts without floating-point conversion", async () => {
  const sellerId = await addSeller("decimal-amount", { verificationStatus: "VERIFIED" });
  const { response, data } = await api("/api/payments", { method: "POST", body: createBody(sellerId, "0.10"), idempotencyKey: "payment-test-decimal-amount" });
  assert.equal(response.status, 200);
  assert.equal(data.payment.amount, "0.10");
  const invalid = await api("/api/payments", { method: "POST", body: createBody(sellerId, "0.001"), idempotencyKey: "payment-test-invalid-exponent" });
  assert.equal(invalid.response.status, 400);
});

test("cancellation is an internal state transition and completed payments cannot be cancelled", async () => {
  const sellerId = await addSeller("cancel", { verificationStatus: "VERIFIED" });
  const created = await api("/api/payments", { method: "POST", body: createBody(sellerId), idempotencyKey: "payment-test-cancel" });
  const cancelled = await api(`/api/payments/${created.data.payment.paymentId}/cancel`, { method: "POST" });
  assert.equal(cancelled.data.payment.status, "CANCELLED");
  const rejected = await api(`/api/payments/${created.data.payment.paymentId}/capture`, { method: "POST" });
  assert.equal(rejected.response.status, 409);
});

test("rate limits authenticated payment API requests with an actionable response", async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await api("/api/payments/rate-limit-probe", { user: buyerC });
    assert.equal(response.response.status, 404);
  }
  const limited = await api("/api/payments/rate-limit-probe", { user: buyerC });
  assert.equal(limited.response.status, 429);
  assert.match(limited.data.message, /Too many payment requests/);
});

test.after(async () => {
  try {
    if (buyerA?._id || buyerB?._id || buyerC?._id) {
      const buyerIds = [buyerA?._id, buyerB?._id, buyerC?._id].filter(Boolean);
      const payments = await Payment.find({ buyerId: { $in: buyerIds } }).select("paymentId").lean();
      await PayPalWebhookEvent.deleteMany({ paymentId: { $in: payments.map((payment) => payment.paymentId) } });
      await Payment.deleteMany({ buyerId: { $in: buyerIds } });
      await User.deleteMany({ _id: { $in: buyerIds } });
    }
    await Seller.deleteMany({ sellerId: { $regex: `^${sellerPrefix}` } });
  } finally {
    try {
      if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      await disconnectTestDatabase();
    }
  }
});

async function addSeller(suffix, overrides = {}) {
  const sellerId = `${sellerPrefix}${suffix}`;
  await Seller.create({
    sellerId,
    displayName: `Payment Test ${suffix}`,
    beneficiaryIds: [],
    verificationStatus: "VERIFIED",
    riskStatus: "UNASSESSED",
    ...overrides,
  });
  return sellerId;
}

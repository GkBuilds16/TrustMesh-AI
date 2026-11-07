import mongoose from "mongoose";

const riskFindingSchema = new mongoose.Schema(
  {
    rule: { type: String, required: true },
    points: { type: Number, required: true, min: 0, max: 100 },
    description: { type: String, required: true },
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    refundId: { type: String, required: true },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: ["COMPLETED"], required: true },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, immutable: true },
    paypalOrderId: { type: String, default: undefined },
    paypalCaptureId: { type: String, default: undefined },
    refunds: { type: [refundSchema], default: [] },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    sellerId: { type: String, required: true, immutable: true },
    amount: {
      type: String,
      required: true,
      match: /^\d{1,8}\.\d{2}$/,
      immutable: true,
    },
    currency: {
      type: String,
      required: true,
      enum: ["USD", "EUR", "GBP"],
      immutable: true,
    },
    status: {
      type: String,
      required: true,
      enum: [
        "CREATED",
        "RISK_PENDING",
        "APPROVED",
        "REVIEW_REQUIRED",
        "BLOCKED",
        "CAPTURE_PENDING",
        "CAPTURE_UNCERTAIN",
        "COMPLETED",
        "REFUNDED",
        "REVERSED",
        "FAILED",
        "CANCELLED",
      ],
      default: "CREATED",
    },
    riskScore: { type: Number, min: 0, max: 100, default: null },
    riskDecision: { type: String, enum: ["ALLOW", "REVIEW", "BLOCK", null], default: null },
    riskFindings: { type: [riskFindingSchema], default: [] },
    riskAssessmentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    orderLeaseUntil: { type: Date, default: null },
    idempotencyKey: { type: String, required: true, immutable: true },
    captureLeaseUntil: { type: Date, default: null },
    failureCode: { type: String, default: null },
    failureMessage: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true, versionKey: false }
);

paymentSchema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ paypalOrderId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ paypalCaptureId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ buyerId: 1, createdAt: -1 });

const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
export default Payment;

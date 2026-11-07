import mongoose from "mongoose";

const payPalWebhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, immutable: true },
    eventType: { type: String, required: true, immutable: true },
    resourceId: { type: String, default: null, immutable: true },
    paymentId: { type: String, default: null, immutable: true },
    processed: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

const PayPalWebhookEvent =
  mongoose.models.PayPalWebhookEvent ||
  mongoose.model("PayPalWebhookEvent", payPalWebhookEventSchema);

export default PayPalWebhookEvent;

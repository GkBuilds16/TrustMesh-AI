
import mongoose from "mongoose";

const findingSchema = new mongoose.Schema(
  {
    rule: {
      type: String,
      required: true,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    description: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const riskAssessmentSchema = new mongoose.Schema(
  {
    targetSellerId: {
      type: String,
      default: null,
      index: true,
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    decision: {
      type: String,
      required: true,
      enum: ["ALLOW", "REVIEW", "BLOCK"],
    },
    findings: {
      type: [findingSchema],
      default: [],
    },
    explanation: {
      type: [String],
      default: [],
    },
    graph: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    disclaimer: {
      type: String,
      required: true,
    },
    engineVersion: {
      type: String,
      default: "prototype-v1",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const RiskAssessment =
  mongoose.models.RiskAssessment ||
  mongoose.model("RiskAssessment", riskAssessmentSchema);

export default RiskAssessment;

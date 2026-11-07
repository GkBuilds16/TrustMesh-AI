
import mongoose from "mongoose";

const investigationCaseSchema = new mongoose.Schema(
  {
    sellerId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },

    actionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    actionTitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    priority: {
      type: String,
      required: true,
      enum: ["HIGH", "MEDIUM", "LOW"],
    },

    status: {
      type: String,
      required: true,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: "OPEN",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// One case per analyst, seller, and recommendation.
investigationCaseSchema.index(
  { createdBy: 1, sellerId: 1, actionId: 1 },
  { unique: true }
);

const InvestigationCase =
  mongoose.models.InvestigationCase ||
  mongoose.model("InvestigationCase", investigationCaseSchema);

export default InvestigationCase;

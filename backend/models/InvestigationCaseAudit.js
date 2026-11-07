
import mongoose from "mongoose";

const investigationCaseAuditSchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestigationCase",
      required: true,
      index: true,
    },
    sellerId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "CASE_CREATED",
        "STATUS_CHANGED",
        "NOTES_UPDATED",
        "CASE_RESOLVED",
      ],
    },
    previousStatus: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: null,
    },
    newStatus: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: null,
    },
    notesChanged: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

investigationCaseAuditSchema.index({
  caseId: 1,
  createdAt: 1,
});

const InvestigationCaseAudit =
  mongoose.models.InvestigationCaseAudit ||
  mongoose.model(
    "InvestigationCaseAudit",
    investigationCaseAuditSchema
  );

export default InvestigationCaseAudit;

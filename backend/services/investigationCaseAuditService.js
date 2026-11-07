
import mongoose from "mongoose";
import InvestigationCase from "../models/InvestigationCase.js";
import InvestigationCaseAudit from "../models/InvestigationCaseAudit.js";

export async function listInvestigationCaseAudit({
  userId,
  caseId,
} = {}) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new Error("A valid authenticated user ID is required.");
  }

  if (!caseId || !mongoose.isValidObjectId(caseId)) {
    throw new Error("A valid investigation case ID is required.");
  }

  // Verify ownership before returning any audit events.
  const ownedCase = await InvestigationCase.findOne({
    _id: caseId,
    createdBy: userId,
  })
    .select("_id")
    .lean();

  if (!ownedCase) {
    return null;
  }

  return InvestigationCaseAudit.find({
    caseId: ownedCase._id,
    actorId: userId,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
}

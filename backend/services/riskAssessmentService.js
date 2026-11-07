
import RiskAssessment from "../models/RiskAssessment.js";

export async function saveRiskAssessment({
  evidence,
  targetSellerId = null,
  assessment,
}) {
  if (!assessment || typeof assessment !== "object") {
    throw new Error("A valid assessment is required.");
  }

  return RiskAssessment.create({
    targetSellerId,
    evidence,
    score: assessment.score,
    decision: assessment.decision,
    findings: assessment.findings,
    explanation: assessment.explanation,
    graph: assessment.graph,
    disclaimer: assessment.disclaimer,
    engineVersion: "prototype-v1",
  });
}

export async function getRiskAssessmentById(assessmentId) {
  if (
    typeof assessmentId !== "string" ||
    !/^[a-f\d]{24}$/i.test(assessmentId)
  ) {
    return null;
  }

  return RiskAssessment.findById(assessmentId).lean();
}

export async function getRiskAssessmentsBySellerId(sellerId) {
  if (typeof sellerId !== "string" || !sellerId.trim()) {
    throw new Error("A non-empty sellerId is required.");
  }

  return RiskAssessment.find({
    targetSellerId: sellerId.trim(),
  })
    .sort({ createdAt: -1 })
    .lean();
}

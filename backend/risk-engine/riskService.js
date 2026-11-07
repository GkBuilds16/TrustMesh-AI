
import { calculateRiskScore } from "./riskScorer.js";
import { decideRiskAction } from "./policyEngine.js";
import { analyzeSellerGraph } from "../graph-engine/graphEngine.js";

export function evaluateTransaction({
  evidence = {},
  targetSellerId,
  sellers = [],
  flaggedSellerIds = [],
} = {}) {
  const graph = targetSellerId
    ? analyzeSellerGraph({
        targetSellerId,
        sellers,
        flaggedSellerIds,
      })
    : null;

  const graphHasFlaggedConnection =
    graph?.riskSignals.some(
      (signal) =>
        signal.type ===
        "SHARED_BENEFICIARY_WITH_FLAGGED_SELLER"
    ) ?? false;

  const combinedEvidence = {
    ...evidence,
    sharedBeneficiary:
      evidence.sharedBeneficiary === true ||
      graphHasFlaggedConnection,
  };

  const { score, findings } =
    calculateRiskScore(combinedEvidence);

  return {
    score,
    decision: decideRiskAction(score),
    findings,
    graph,
    explanation:
      findings.length === 0
        ? ["No configured risk signals were detected in the supplied evidence."]
        : findings.map((finding) => finding.description),
    disclaimer:
      "Prototype assessment based on supplied evidence and synthetic graph data; not proof of fraud.",
  };
}


import { RISK_RULES } from "./riskRules.js";

export function calculateRiskScore(evidence = {}) {
  const findings = [];
  let score = 0;

  const checks = [
    ["FLAGGED_SELLER", evidence.sellerFlagged === true],
    ["SHARED_BENEFICIARY", evidence.sharedBeneficiary === true],
    ["HIGH_TRANSACTION_VELOCITY", evidence.highTransactionVelocity === true],
    ["UNUSUAL_TRANSACTION_AMOUNT", evidence.unusualTransactionAmount === true],
    ["INCOMPLETE_SELLER_VERIFICATION", evidence.incompleteSellerVerification === true],
  ];

  for (const [ruleName, triggered] of checks) {
    if (!triggered) continue;

    const rule = RISK_RULES[ruleName];
    score += rule.points;

    findings.push({
      rule: ruleName,
      points: rule.points,
      description: rule.description,
    });
  }

  return {
    score: Math.min(score, 100),
    findings,
  };
}

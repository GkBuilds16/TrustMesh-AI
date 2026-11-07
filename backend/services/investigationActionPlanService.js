
const ACTION_PRIORITY = {
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function generateInvestigationActionPlan({
  seller,
  graph,
  recentAssessments = [],
} = {}) {
  if (!seller || typeof seller.sellerId !== "string") {
    throw new Error("A valid seller record is required.");
  }

  const actions = [];
  const relatedSellers = graph?.relatedSellers ?? [];
  const connections = graph?.connections ?? [];

  // 1. Verify seller identity and onboarding information.
  if (seller.verificationStatus !== "VERIFIED") {
    actions.push({
      id: "VERIFY_SELLER_IDENTITY",
      priority: "HIGH",
      title: "Verify seller identity",
      reason: `Seller verification status is ${seller.verificationStatus ?? "UNKNOWN"}.`,
      evidence: {
        type: "SELLER_VERIFICATION_STATUS",
        value: seller.verificationStatus ?? "UNKNOWN",
      },
      recommendedSteps: [
        "Review the seller's submitted identity and business information.",
        "Confirm that required verification checks are complete.",
        "Record the verification outcome before changing the seller's status.",
      ],
    });
  }

  // 2. Review relationships supported by shared beneficiary evidence.
  const evidencedConnections = connections.filter(
    (connection) =>
      connection.relationship === "SHARED_BENEFICIARY" &&
      connection.evidenceAvailable === true &&
      Array.isArray(connection.sharedBeneficiaryIds) &&
      connection.sharedBeneficiaryIds.length > 0
  );

  const flaggedConnections = evidencedConnections.filter(
    (connection) => connection.flaggedConnection === true
  );

  if (flaggedConnections.length > 0) {
    actions.push({
      id: "REVIEW_FLAGGED_NETWORK_CONNECTIONS",
      priority: "HIGH",
      title: "Investigate flagged network connections",
      reason:
        "The seller shares beneficiary identifiers with one or more sellers marked as flagged.",
      evidence: {
        type: "SHARED_BENEFICIARY_WITH_FLAGGED_SELLER",
        connections: flaggedConnections.map((connection) => ({
          relatedSellerId: connection.targetSellerId,
          sharedBeneficiaryIds: connection.sharedBeneficiaryIds,
        })),
      },
      recommendedSteps: [
        "Review each linked seller's investigation report.",
        "Verify whether the shared beneficiary relationship is legitimate.",
        "Check independent transaction and identity evidence before taking action.",
      ],
    });
  } else if (evidencedConnections.length > 0) {
    actions.push({
      id: "REVIEW_SHARED_BENEFICIARIES",
      priority: "MEDIUM",
      title: "Review shared beneficiary relationships",
      reason:
        "The seller has beneficiary relationships connecting it to other registered sellers.",
      evidence: {
        type: "SHARED_BENEFICIARY",
        connections: evidencedConnections.map((connection) => ({
          relatedSellerId: connection.targetSellerId,
          sharedBeneficiaryIds: connection.sharedBeneficiaryIds,
        })),
      },
      recommendedSteps: [
        "Confirm that the shared beneficiary relationship is expected.",
        "Compare the sellers' business and verification information.",
        "Escalate only if additional evidence supports further investigation.",
      ],
    });
  }

  // 3. Use the latest saved assessment to identify transaction-related signals.
  const latestAssessment = recentAssessments[0];

  const latestFindings = Array.isArray(latestAssessment?.findings)
    ? latestAssessment.findings
    : [];

  const findingRules = new Set(
    latestFindings.map((finding) => finding.rule)
  );

  if (findingRules.has("HIGH_TRANSACTION_VELOCITY")) {
    actions.push({
      id: "REVIEW_TRANSACTION_VELOCITY",
      priority: "HIGH",
      title: "Review transaction velocity",
      reason:
        "The latest saved risk assessment contains a high-transaction-velocity finding.",
      evidence: {
        type: "HIGH_TRANSACTION_VELOCITY",
        assessmentId: String(latestAssessment._id),
      },
      recommendedSteps: [
        "Review transaction counts over the relevant time window.",
        "Compare activity with the seller's established baseline.",
        "Confirm the signal using transaction records before escalating.",
      ],
    });
  }

  if (findingRules.has("UNUSUAL_TRANSACTION_AMOUNT")) {
    actions.push({
      id: "REVIEW_UNUSUAL_TRANSACTION_AMOUNTS",
      priority: "MEDIUM",
      title: "Review unusual transaction amounts",
      reason:
        "The latest saved risk assessment contains an unusual-transaction-amount finding.",
      evidence: {
        type: "UNUSUAL_TRANSACTION_AMOUNT",
        assessmentId: String(latestAssessment._id),
      },
      recommendedSteps: [
        "Compare the flagged amounts with the seller's historical activity.",
        "Check available order and payment records.",
        "Determine whether a documented business explanation exists.",
      ],
    });
  }

  // 4. If no rule generated an action, suggest a basic review.
  if (actions.length === 0) {
    actions.push({
      id: "COMPLETE_STANDARD_REVIEW",
      priority: "LOW",
      title: "Complete standard seller review",
      reason:
        "No configured condition in the available investigation data triggered a specific action.",
      evidence: {
        type: "NO_CONFIGURED_ACTION_TRIGGERED",
      },
      recommendedSteps: [
        "Confirm that the seller profile is accurate.",
        "Review available assessment history.",
        "Reassess if new evidence becomes available.",
      ],
    });
  }

  actions.sort(
    (a, b) => ACTION_PRIORITY[a.priority] - ACTION_PRIORITY[b.priority]
  );

  return {
    sellerId: seller.sellerId,
    generatedFrom: {
      sellerVerificationStatus: seller.verificationStatus ?? "UNKNOWN",
      relatedSellerCount: relatedSellers.length,
      evidencedConnectionCount: evidencedConnections.length,
      latestAssessmentId: latestAssessment?._id
        ? String(latestAssessment._id)
        : null,
    },
    actions,
    disclaimer:
      "These are rule-based investigation recommendations derived from available records. They are not proof of fraud and do not automatically block transactions or change seller status.",
  };
}


/**
 * Prototype seller relationship graph.
 * Uses synthetic seller data; a connection is a risk signal,
 * not proof that a seller is fraudulent.
 */

export function analyzeSellerGraph({
  targetSellerId,
  sellers = [],
  flaggedSellerIds = [],
}) {
  if (
    typeof targetSellerId !== "string" ||
    targetSellerId.trim() === ""
  ) {
    throw new Error("targetSellerId must be a non-empty string");
  }

  if (!Array.isArray(sellers) || !Array.isArray(flaggedSellerIds)) {
    throw new Error("sellers and flaggedSellerIds must be arrays");
  }

  const target = sellers.find(
    (seller) => seller.id === targetSellerId
  );

  if (!target) {
    return {
      targetSellerId,
      found: false,
      riskSignals: [],
      relatedSellerIds: [],
    };
  }

  const flaggedSet = new Set(flaggedSellerIds);
  const targetBeneficiaries = new Set(
    target.beneficiaryIds ?? []
  );

  const relatedSellers = sellers.filter((seller) => {
    if (seller.id === targetSellerId) return false;

    const beneficiaryIds = seller.beneficiaryIds ?? [];

    return beneficiaryIds.some((id) =>
      targetBeneficiaries.has(id)
    );
  });

  const relatedSellerIds = relatedSellers.map(
    (seller) => seller.id
  );

  const flaggedConnections = relatedSellers.filter((seller) =>
    flaggedSet.has(seller.id)
  );

  const riskSignals = [];

  if (flaggedConnections.length > 0) {
    riskSignals.push({
      type: "SHARED_BENEFICIARY_WITH_FLAGGED_SELLER",
      relatedSellerIds: flaggedConnections.map(
        (seller) => seller.id
      ),
      description:
        "The seller shares a beneficiary identifier with one or more flagged seller accounts.",
    });
  }

  return {
    targetSellerId,
    found: true,
    relatedSellerIds,
    riskSignals,
    flaggedConnectionCount: flaggedConnections.length,
  };
}

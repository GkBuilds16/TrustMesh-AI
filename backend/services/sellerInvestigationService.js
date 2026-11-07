
import {
  getSellerById,
  getAllSellers,
} from "./sellerService.js";
import {
  generateInvestigationActionPlan,
} from "./investigationActionPlanService.js";

import { analyzeSellerGraph } from "../graph-engine/graphEngine.js";

import {
  getRiskAssessmentsBySellerId,
} from "./riskAssessmentService.js";

export async function investigateSeller(sellerId) {
  if (typeof sellerId !== "string" || !sellerId.trim()) {
    throw new Error("A non-empty sellerId is required.");
  }

  const normalizedSellerId = sellerId.trim();
  const seller = await getSellerById(normalizedSellerId);

  if (!seller) {
    return null;
  }

  const storedSellers = await getAllSellers();

  const graphSellers = storedSellers.map((item) => ({
    id: item.sellerId,
    beneficiaryIds: item.beneficiaryIds,
  }));

  const flaggedSellerIds = storedSellers
    .filter((item) => item.riskStatus === "FLAGGED")
    .map((item) => item.sellerId);

  const graph = analyzeSellerGraph({
    targetSellerId: seller.sellerId,
    sellers: graphSellers,
    flaggedSellerIds,
  });

  // Return full details for sellers that the graph identifies as related.
  const relatedSellerIds = graph.relatedSellerIds || [];
  const relatedSellers = storedSellers
    .filter((item) => relatedSellerIds.includes(item.sellerId))
    .map((item) => ({
      sellerId: item.sellerId,
      displayName: item.displayName,
      verificationStatus: item.verificationStatus,
      riskStatus: item.riskStatus,
    }));

  // Build explicit evidence for each relationship with the target seller.
  const targetBeneficiaries = new Set(seller.beneficiaryIds || []);

  const connections = relatedSellers.map((relatedSeller) => {
    const storedRelatedSeller = storedSellers.find(
      (item) => item.sellerId === relatedSeller.sellerId
    );

    const sharedBeneficiaryIds = (
      storedRelatedSeller?.beneficiaryIds || []
    ).filter((id) => targetBeneficiaries.has(id));

    return {
      sourceSellerId: seller.sellerId,
      targetSellerId: relatedSeller.sellerId,
      relationship: "SHARED_BENEFICIARY",
      sharedBeneficiaryIds,
      evidenceAvailable: sharedBeneficiaryIds.length > 0,
      flaggedConnection: flaggedSellerIds.includes(
        relatedSeller.sellerId
      ),
    };
  });

  const recentAssessments =
    await getRiskAssessmentsBySellerId(normalizedSellerId);
    const actionPlan = generateInvestigationActionPlan({
  seller: {
    sellerId: seller.sellerId,
    verificationStatus: seller.verificationStatus,
  },
  graph: {
    ...graph,
    relatedSellers,
    connections,
  },
  recentAssessments,
});

  return {
    seller: {
      sellerId: seller.sellerId,
      displayName: seller.displayName,
      beneficiaryIds: seller.beneficiaryIds,
      verificationStatus: seller.verificationStatus,
      riskStatus: seller.riskStatus,
      createdAt: seller.createdAt,
    },
    graph: {
      ...graph,
      relatedSellers,
      connections,
    },
    actionPlan,
    recentAssessments: recentAssessments.slice(0, 10),
    investigationDisclaimer:
      "This report summarizes stored records and configured risk signals. A connection or risk finding is not proof of fraud.",
  };
}

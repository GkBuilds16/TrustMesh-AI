
import { evaluateTransaction } from "../risk-engine/riskService.js";
import { getAllSellers } from "../services/sellerService.js";
import { saveRiskAssessment } from "../services/riskAssessmentService.js";

const ALLOWED_EVIDENCE_KEYS = new Set([
  "sharedBeneficiary",
  "highTransactionVelocity",
  "unusualTransactionAmount",
  "incompleteSellerVerification",
]);

export async function evaluateRisk(req, res, next) {
  try {
    const {
      evidence,
      targetSellerId,
      sellers,
      flaggedSellerIds,
    } = req.body ?? {};

    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide an evidence object.",
      });
    }

    if (
      Object.keys(evidence).some(
        (key) => !ALLOWED_EVIDENCE_KEYS.has(key)
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Evidence contains an unsupported field.",
      });
    }

    if (
      Object.values(evidence).some(
        (value) => typeof value !== "boolean"
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Every evidence value must be true or false.",
      });
    }

    if (
      targetSellerId !== undefined &&
      (typeof targetSellerId !== "string" ||
        !targetSellerId.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "targetSellerId must be a non-empty string.",
      });
    }

    let assessment;
    let storedTargetSellerId = null;

    if (targetSellerId !== undefined) {
      if (sellers !== undefined || flaggedSellerIds !== undefined) {
        return res.status(400).json({
          success: false,
          message:
            "Do not supply sellers or flaggedSellerIds for database-backed analysis.",
        });
      }

      const storedSellers = await getAllSellers();

      const target = storedSellers.find(
        (seller) => seller.sellerId === targetSellerId.trim()
      );

      if (!target) {
        return res.status(404).json({
          success: false,
          message: "Target seller not found.",
        });
      }

      const graphSellers = storedSellers.map((seller) => ({
        id: seller.sellerId,
        beneficiaryIds: seller.beneficiaryIds,
      }));

      const storedFlaggedSellerIds = storedSellers
        .filter((seller) => seller.riskStatus === "FLAGGED")
        .map((seller) => seller.sellerId);

      assessment = evaluateTransaction({
        evidence,
        targetSellerId: target.sellerId,
        sellers: graphSellers,
        flaggedSellerIds: storedFlaggedSellerIds,
      });

      storedTargetSellerId = target.sellerId;
    } else {
      if (sellers !== undefined) {
        if (!Array.isArray(sellers)) {
          return res.status(400).json({
            success: false,
            message: "sellers must be an array.",
          });
        }

        const validSellers = sellers.every(
          (seller) =>
            seller !== null &&
            typeof seller === "object" &&
            !Array.isArray(seller) &&
            typeof seller.id === "string" &&
            seller.id.trim() !== "" &&
            Array.isArray(seller.beneficiaryIds) &&
            seller.beneficiaryIds.every(
              (id) => typeof id === "string" && id.trim() !== ""
            )
        );

        if (!validSellers) {
          return res.status(400).json({
            success: false,
            message:
              "Each seller must have a non-empty id and an array of beneficiaryIds.",
          });
        }

        const ids = sellers.map((seller) => seller.id);

        if (new Set(ids).size !== ids.length) {
          return res.status(400).json({
            success: false,
            message: "Seller IDs must be unique.",
          });
        }
      }

      if (flaggedSellerIds !== undefined) {
        if (
          !Array.isArray(flaggedSellerIds) ||
          !flaggedSellerIds.every(
            (id) => typeof id === "string" && id.trim() !== ""
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "flaggedSellerIds must be an array of non-empty strings.",
          });
        }
      }

      assessment = evaluateTransaction({
        evidence,
        sellers,
        flaggedSellerIds,
      });
    }

    // Persist the result before returning success.
    const savedAssessment = await saveRiskAssessment({
      evidence,
      targetSellerId: storedTargetSellerId,
      assessment,
    });

    return res.status(200).json({
      success: true,
      assessment: {
        ...assessment,
        assessmentId: savedAssessment.id,
        createdAt: savedAssessment.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

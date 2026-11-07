
import {
  getRiskAssessmentById,
  getRiskAssessmentsBySellerId,
} from "../services/riskAssessmentService.js";

export async function fetchRiskAssessment(req, res, next) {
  try {
    const assessment = await getRiskAssessmentById(
      req.params.assessmentId
    );

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: "Risk assessment not found.",
      });
    }

    return res.status(200).json({
      success: true,
      assessment,
    });
  } catch (error) {
    next(error);
  }
}

export async function fetchSellerRiskHistory(req, res, next) {
  try {
    const { sellerId } = req.params;

    if (!sellerId || !sellerId.trim()) {
      return res.status(400).json({
        success: false,
        message: "A non-empty sellerId is required.",
      });
    }

    const assessments = await getRiskAssessmentsBySellerId(sellerId);

    return res.status(200).json({
      success: true,
      sellerId,
      count: assessments.length,
      assessments,
    });
  } catch (error) {
    next(error);
  }
}

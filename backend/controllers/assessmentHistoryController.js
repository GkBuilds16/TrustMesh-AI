
import { getAssessmentHistory } from "../services/assessmentHistoryService.js";

export async function fetchAssessmentHistory(req, res, next) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const targetSellerId = req.query.targetSellerId;

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      return res.status(400).json({
        success: false,
        message:
          "page must be a positive integer and limit must be between 1 and 50.",
      });
    }

    if (
      targetSellerId !== undefined &&
      (typeof targetSellerId !== "string" ||
        (targetSellerId !== "general" && !targetSellerId.trim()))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "targetSellerId must be a non-empty seller ID or 'general'.",
      });
    }

    const result = await getAssessmentHistory({
      page,
      limit,
      targetSellerId,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

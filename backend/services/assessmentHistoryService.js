
import RiskAssessment from "../models/RiskAssessment.js";

export async function getAssessmentHistory({
  page = 1,
  limit = 10,
  targetSellerId,
} = {}) {
  const safePage = Number.isInteger(Number(page))
    ? Math.max(1, Number(page))
    : 1;

  const safeLimit = Number.isInteger(Number(limit))
    ? Math.min(50, Math.max(1, Number(limit)))
    : 10;

  const filter = {};

  if (targetSellerId === "general") {
    filter.targetSellerId = null;
  } else if (typeof targetSellerId === "string" && targetSellerId.trim()) {
    filter.targetSellerId = targetSellerId.trim();
  }

  const skip = (safePage - 1) * safeLimit;

  const [assessments, total] = await Promise.all([
    RiskAssessment.find(filter)
      .select(
        "_id targetSellerId score decision findings explanation engineVersion createdAt"
      )
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),

    RiskAssessment.countDocuments(filter),
  ]);

  return {
    assessments,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

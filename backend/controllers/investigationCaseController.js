
import {
  listInvestigationCases,
  createInvestigationCase,
  updateInvestigationCase,
} from "../services/investigationCaseService.js";

function getUserId(req) {
  return req.user?.sub;
}

export async function fetchInvestigationCases(req, res, next) {
  try {
    const cases = await listInvestigationCases({
      userId: getUserId(req),
      sellerId: req.query.sellerId,
      status: req.query.status,
    });

    return res.status(200).json({
      success: true,
      count: cases.length,
      cases,
    });
  } catch (error) {
    if (
      error.message?.includes("required") ||
      error.message?.includes("Invalid")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}

export async function createInvestigationCaseRecord(req, res, next) {
  try {
    const record = await createInvestigationCase({
      userId: getUserId(req),
      sellerId: req.body?.sellerId,
      action: req.body?.action,
    });

    return res.status(201).json({
      success: true,
      case: record,
    });
  } catch (error) {
    if (error.code === "SELLER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error.message?.includes("required") ||
      error.message?.includes("valid") ||
      error.message?.includes("invalid") ||
      error.message?.includes("must be")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}

export async function updateInvestigationCaseRecord(req, res, next) {
  try {
    const record = await updateInvestigationCase({
      userId: getUserId(req),
      caseId: req.params.caseId,
      status: req.body?.status,
      resolutionNotes: req.body?.resolutionNotes,
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Investigation case not found.",
      });
    }

    return res.status(200).json({
      success: true,
      case: record,
    });
  } catch (error) {
    if (error.code === "CASE_ALREADY_RESOLVED") {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error.message?.includes("required") ||
      error.message?.includes("valid") ||
      error.message?.includes("Invalid") ||
      error.message?.includes("must be")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}

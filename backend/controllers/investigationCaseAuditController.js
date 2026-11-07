
import {
  listInvestigationCaseAudit,
} from "../services/investigationCaseAuditService.js";

export async function getInvestigationCaseAudit(req, res, next) {
  try {
    const events = await listInvestigationCaseAudit({
      userId: req.user.sub,
      caseId: req.params.caseId,
    });

    if (events === null) {
      return res.status(404).json({
        success: false,
        message: "Investigation case not found.",
      });
    }

    return res.status(200).json({
      success: true,
      events,
    });
  } catch (error) {
    if (error.message === "A valid investigation case ID is required.") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  }
}

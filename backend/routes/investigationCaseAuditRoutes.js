
import { Router } from "express";
import {
  getInvestigationCaseAudit,
} from "../controllers/investigationCaseAuditController.js";

const router = Router();

router.get("/:caseId/audit", getInvestigationCaseAudit);

export default router;

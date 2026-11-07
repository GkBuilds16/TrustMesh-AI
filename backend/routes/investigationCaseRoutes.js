
import { Router } from "express";

import {
  fetchInvestigationCases,
  createInvestigationCaseRecord,
  updateInvestigationCaseRecord,
} from "../controllers/investigationCaseController.js";

const router = Router();

// List cases belonging to the authenticated analyst.
router.get("/", fetchInvestigationCases);

// Create a case from an existing investigation recommendation.
router.post("/", createInvestigationCaseRecord);

// Update a case owned by the authenticated analyst.
router.patch("/:caseId", updateInvestigationCaseRecord);

export default router;

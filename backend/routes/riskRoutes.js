
import { Router } from "express";

import { evaluateRisk } from "../controllers/riskController.js";

import {
  fetchRiskAssessment,
  fetchSellerRiskHistory,
} from "../controllers/riskAssessmentController.js";

import {
  fetchAssessmentHistory,
} from "../controllers/assessmentHistoryController.js";

const router = Router();

router.post("/evaluate", evaluateRisk);

// Saved assessment history — must remain protected by app-level requireAuth.
router.get("/assessments", fetchAssessmentHistory);

router.get("/assessments/:assessmentId", fetchRiskAssessment);

router.get(
  "/sellers/:sellerId/history",
  fetchSellerRiskHistory
);

export default router;

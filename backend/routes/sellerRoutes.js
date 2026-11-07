
import { Router } from "express";

import {
  registerSeller,
  fetchSeller,
  listSellers,
} from "../controllers/sellerController.js";

import {
  fetchSellerInvestigation,
} from "../controllers/sellerInvestigationController.js";

const router = Router();

router.post("/", registerSeller);
router.get("/", listSellers);

// Keep this specific route before /:sellerId.
router.get("/:sellerId/investigation", fetchSellerInvestigation);

router.get("/:sellerId", fetchSeller);

export default router;

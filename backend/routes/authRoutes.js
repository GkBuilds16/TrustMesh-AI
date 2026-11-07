
import { Router } from "express";
import { register, login } from "../controllers/authController.js";
import {
  loginRateLimit,
  registrationRateLimit,
} from "../middleware/authRateLimit.js";

const router = Router();

router.post("/register", registrationRateLimit, register);
router.post("/login", loginRateLimit, login);

export default router;

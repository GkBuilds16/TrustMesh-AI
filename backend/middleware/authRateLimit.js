import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const commonOptions = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
};

export const loginRateLimit = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

export const registrationRateLimit = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    success: false,
    message: "Too many registration attempts. Please try again later.",
  },
});

export const paymentRateLimit = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many payment requests. Please wait before trying again.",
  },
});

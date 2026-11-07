
import {
  registerUser,
  loginUser,
} from "../services/authService.js";

export async function register(req, res, next) {
  try {
    const result = await registerUser(req.body ?? {});

    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.code === "EMAIL_EXISTS" || error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    if (
      error.message?.includes("required") ||
      error.message?.includes("characters") ||
      error.message?.includes("Password") ||
      error.message?.includes("email address")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const result = await loginUser(req.body ?? {});

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error.code === "INVALID_CREDENTIALS") {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (error.message === "Email and password are required.") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}


import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please log in.",
    });
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is missing.",
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret || secret === "REPLACE_WITH_A_LONG_RANDOM_SECRET") {
    return res.status(500).json({
      success: false,
      message: "Authentication is not configured correctly.",
    });
  }

  try {
    req.user = jwt.verify(token, secret, {
      issuer: "trustmesh-ai",
      audience: "trustmesh-ai-app",
    });

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
}

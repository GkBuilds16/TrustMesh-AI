
import jwt from "jsonwebtoken";

export function createTestToken() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret === "REPLACE_WITH_A_LONG_RANDOM_SECRET") {
    throw new Error(
      "A valid JWT_SECRET must be configured in backend/.env.test"
    );
  }

  return jwt.sign(
    {
      sub: "automated-test-user",
      role: "ANALYST",
    },
    secret,
    {
      expiresIn: "10m",
      issuer: "trustmesh-ai",
      audience: "trustmesh-ai-app",
    }
  );
}

export function authHeaders() {
  return {
    Authorization: `Bearer ${createTestToken()}`,
  };
}

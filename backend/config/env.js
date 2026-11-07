import "dotenv/config";

const requiredVariables = ["MONGODB_URI"];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

const nodeEnv = process.env.NODE_ENV || "development";
const mongodbUri = process.env.MONGODB_URI;

function databaseNameFromUri(uri) {
  try {
    const parsed = new URL(uri);
    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) throw new Error();
    return parsed.pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    throw new Error("MONGODB_URI must be a valid MongoDB connection URI.");
  }
}

if (nodeEnv === "production") {
  if (databaseNameFromUri(mongodbUri) === "trustmesh_test") {
    throw new Error("Production configuration cannot use the trustmesh_test database.");
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === "REPLACE_WITH_A_LONG_RANDOM_SECRET" || Buffer.byteLength(jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 bytes for production.");
  }

  if (!process.env.FRONTEND_BASE_URL) {
    throw new Error("FRONTEND_BASE_URL must be configured for production.");
  }
  try {
    const frontendUrl = new URL(process.env.FRONTEND_BASE_URL);
    if (frontendUrl.protocol !== "https:" || frontendUrl.origin !== process.env.FRONTEND_BASE_URL.replace(/\/$/, "")) {
      throw new Error();
    }
  } catch {
    throw new Error("FRONTEND_BASE_URL must be an HTTPS origin in production.");
  }
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv,
  mongodbUri,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
};

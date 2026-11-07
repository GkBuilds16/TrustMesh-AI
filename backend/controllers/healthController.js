import mongoose from "mongoose";

export function getHealth(req, res) {
  const databaseConnected = mongoose.connection.readyState === 1;

  res.status(databaseConnected ? 200 : 503).json({
    success: databaseConnected,
    application: "TrustMesh AI",
    status: databaseConnected ? "healthy" : "database_unavailable",
    database: databaseConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
}

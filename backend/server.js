import { config } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import app from "./app.js";

let server;
let shutdownPromise;
let isShuttingDown = false;

async function startServer() {
  try {
    await connectDatabase();
    if (isShuttingDown) {
      await disconnectDatabase();
      return;
    }

    server = app.listen(config.port, "0.0.0.0");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    console.log(`TrustMesh AI API listening on port ${config.port}`);
  } catch (error) {
    console.error("Failed to start TrustMesh AI:", error?.code || error?.name || "STARTUP_ERROR");
    await disconnectDatabase().catch(() => {});
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  isShuttingDown = true;
  shutdownPromise = (async () => {
    console.log(`Received ${signal}; shutting down TrustMesh AI.`);
    let shutdownFailed = false;
    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    } catch {
      shutdownFailed = true;
    }
    try {
      await disconnectDatabase();
    } catch {
      shutdownFailed = true;
    }
    if (shutdownFailed) {
      console.error("TrustMesh AI graceful shutdown failed.");
      process.exitCode = 1;
    }
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

startServer();

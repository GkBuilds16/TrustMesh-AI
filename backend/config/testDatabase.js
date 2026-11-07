
import mongoose from "mongoose";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});

const testUri = process.env.MONGODB_URI;

if (!testUri) {
  throw new Error(
    "MONGODB_URI is missing from backend/.env.test"
  );
}

let databaseName;

try {
  databaseName = new URL(testUri).pathname
    .split("/")
    .filter(Boolean)[0];
} catch {
  throw new Error("MONGODB_URI in .env.test is not a valid URL");
}

if (databaseName !== "trustmesh_test") {
  throw new Error(
    `Safety check failed: expected trustmesh_test, received ${databaseName || "(no database name)"}`
  );
}

export async function connectTestDatabase() {
  try {
    await mongoose.connect(testUri, {
      serverSelectionTimeoutMS: 10000,
    });

    if (mongoose.connection.name !== "trustmesh_test") {
      throw new Error("Connected database did not match trustmesh_test");
    }

    console.log("Connected to isolated test database");
  } catch (error) {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }

    if (error.message === "Connected database did not match trustmesh_test") {
      throw error;
    }

    throw new Error(
      "Unable to connect to the isolated trustmesh_test database. Check that the Atlas cluster is available and that this machine's network is allowed by its IP access list. No tests were run."
    );
  }
}

export async function disconnectTestDatabase() {
  if (
    mongoose.connection.readyState !== 0 &&
    mongoose.connection.name === "trustmesh_test"
  ) {
    await mongoose.disconnect();
  }
}

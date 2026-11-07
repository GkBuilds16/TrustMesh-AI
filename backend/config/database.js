import mongoose from "mongoose";
import { config } from "./env.js";

export async function connectDatabase() {
  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("MongoDB Atlas connected successfully");
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

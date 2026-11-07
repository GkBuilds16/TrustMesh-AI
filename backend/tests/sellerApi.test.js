
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { authHeaders } from "./authTestHelper.js";
const { disconnectTestDatabase } =
  await import("./testDatabaseLifecycle.js");

dotenv.config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});

const { default: app } = await import("../app.js");
const { default: Seller } = await import("../models/Seller.js");

const server = app.listen(0, "127.0.0.1");

const baseUrl = await new Promise((resolve, reject) => {
  server.once("listening", () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${address.port}`);
  });

  server.once("error", reject);
});

test("seller API integration", async (t) => {
  assert.equal(mongoose.connection.name, "trustmesh_test");

  const testIds = ["api-test-seller-A", "api-test-seller-B"];

  t.after(async () => {
    try {
      await Seller.deleteMany({ sellerId: { $in: testIds } });
    } finally {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } finally {
        await disconnectTestDatabase();
      }
    }
  });

  await Seller.deleteMany({ sellerId: { $in: testIds } });

  await t.test("registers a seller", async () => {
    const response = await fetch(`${baseUrl}/api/sellers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        sellerId: "api-test-seller-A",
        displayName: "API Test Seller A",
        beneficiaryIds: ["api-test-beneficiary-1"],
      }),
    });

    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(data.success, true);
    assert.equal(data.seller.sellerId, "api-test-seller-A");
  });

  await t.test("retrieves a seller by ID", async () => {
    const response = await fetch(
      `${baseUrl}/api/sellers/api-test-seller-A`,
      {
        headers: authHeaders(),
      }
    );

    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.seller.displayName, "API Test Seller A");
  });

  await t.test("rejects a duplicate seller ID", async () => {
    const response = await fetch(`${baseUrl}/api/sellers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        sellerId: "api-test-seller-A",
        displayName: "Duplicate Seller",
      }),
    });

    assert.equal(response.status, 409);
  });

  await t.test("returns 404 for an unknown seller", async () => {
    const response = await fetch(
      `${baseUrl}/api/sellers/no-such-test-seller`,
      {
        headers: authHeaders(),
      }
    );

    assert.equal(response.status, 404);
  });
});

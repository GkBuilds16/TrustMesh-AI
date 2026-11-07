
import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { authHeaders } from "./authTestHelper.js";

dotenv.config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});

const { disconnectTestDatabase } =
  await import("./testDatabaseLifecycle.js");

const { default: mongoose } = await import("mongoose");
const { default: Seller } = await import("../models/Seller.js");
const { default: app } = await import("../app.js");

const TEST_IDS = [
  "graph-api-target",
  "graph-api-flagged",
  "graph-api-unrelated",
];

test("risk API detects a database-backed connection to a flagged seller", async (t) => {
  const server = app.listen(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Remove only records reserved for this test.
    await Seller.deleteMany({ sellerId: { $in: TEST_IDS } });

    await Seller.create([
      {
        sellerId: "graph-api-target",
        displayName: "Test Target Seller",
        beneficiaryIds: ["shared-beneficiary-test"],
        riskStatus: "UNASSESSED",
      },
      {
        sellerId: "graph-api-flagged",
        displayName: "Test Flagged Seller",
        beneficiaryIds: ["shared-beneficiary-test"],
        riskStatus: "FLAGGED",
      },
      {
        sellerId: "graph-api-unrelated",
        displayName: "Unrelated Test Seller",
        beneficiaryIds: ["different-beneficiary-test"],
        riskStatus: "UNASSESSED",
      },
    ]);

    const response = await fetch(`${baseUrl}/api/risk/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        evidence: {},
        targetSellerId: "graph-api-target",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.assessment.score, 35);
    assert.equal(body.assessment.decision, "REVIEW");
    assert.equal(
      body.assessment.graph.flaggedConnectionCount,
      1
    );
    assert.ok(
      body.assessment.graph.relatedSellerIds.includes(
        "graph-api-flagged"
      )
    );
    assert.ok(
      !body.assessment.graph.relatedSellerIds.includes(
        "graph-api-unrelated"
      )
    );

    // Client-supplied graph data must not override database records.
    const spoofResponse = await fetch(
      `${baseUrl}/api/risk/evaluate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          evidence: {},
          targetSellerId: "graph-api-target",
          flaggedSellerIds: [],
        }),
      }
    );

    assert.equal(spoofResponse.status, 400);

    console.log("Database-backed seller graph integration passed.");
  } finally {
    try {
      await Seller.deleteMany({ sellerId: { $in: TEST_IDS } });
    } finally {
      try {
        await new Promise((resolveClose, rejectClose) => {
          server.close((error) =>
            error ? rejectClose(error) : resolveClose()
          );
        });
      } finally {
        await disconnectTestDatabase();
      }
    }
  }
});

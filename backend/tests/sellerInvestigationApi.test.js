
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

const { default: Seller } = await import("../models/Seller.js");
const { default: RiskAssessment } =
  await import("../models/RiskAssessment.js");
const { default: app } = await import("../app.js");

const TEST_SELLER_IDS = [
  "investigation-target",
  "investigation-flagged",
  "network-target-flagged",
  "network-related-clear-a",
  "network-target-clear-flagged",
  "network-related-flagged-a",
  "network-target-flagged-both",
  "network-related-flagged-b",
  "network-target-clear-none",
  "network-related-clear-b",
];

const NETWORK_CASES = [
  {
    targetId: "network-target-flagged",
    relatedId: "network-related-clear-a",
    targetRiskStatus: "FLAGGED",
    relatedRiskStatus: "UNASSESSED",
    flaggedConnection: false,
    actionId: "REVIEW_SHARED_BENEFICIARIES",
  },
  {
    targetId: "network-target-clear-flagged",
    relatedId: "network-related-flagged-a",
    targetRiskStatus: "UNASSESSED",
    relatedRiskStatus: "FLAGGED",
    flaggedConnection: true,
    actionId: "REVIEW_FLAGGED_NETWORK_CONNECTIONS",
  },
  {
    targetId: "network-target-flagged-both",
    relatedId: "network-related-flagged-b",
    targetRiskStatus: "FLAGGED",
    relatedRiskStatus: "FLAGGED",
    flaggedConnection: true,
    actionId: "REVIEW_FLAGGED_NETWORK_CONNECTIONS",
  },
  {
    targetId: "network-target-clear-none",
    relatedId: "network-related-clear-b",
    targetRiskStatus: "UNASSESSED",
    relatedRiskStatus: "UNASSESSED",
    flaggedConnection: false,
    actionId: "REVIEW_SHARED_BENEFICIARIES",
  },
];

const server = app.listen(0);
const baseUrl = await new Promise((resolve, reject) => {
  server.once("listening", () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
  server.once("error", reject);
});

test.before(async () => {
  await Seller.deleteMany({
    sellerId: { $in: TEST_SELLER_IDS },
  });

  await RiskAssessment.deleteMany({
    targetSellerId: { $in: TEST_SELLER_IDS },
  });

  const networkSellers = NETWORK_CASES.flatMap((scenario, index) => [
    {
      sellerId: scenario.targetId,
      displayName: scenario.targetId,
      beneficiaryIds: [`network-beneficiary-${index}`],
      verificationStatus: "VERIFIED",
      riskStatus: scenario.targetRiskStatus,
    },
    {
      sellerId: scenario.relatedId,
      displayName: scenario.relatedId,
      beneficiaryIds: [`network-beneficiary-${index}`],
      verificationStatus: "VERIFIED",
      riskStatus: scenario.relatedRiskStatus,
    },
  ]);

  await Seller.create([
    {
      sellerId: "investigation-target",
      displayName: "Investigation Test Seller",
      beneficiaryIds: ["investigation-shared-beneficiary"],
      verificationStatus: "PENDING",
      riskStatus: "UNASSESSED",
    },
    {
      sellerId: "investigation-flagged",
      displayName: "Flagged Test Seller",
      beneficiaryIds: ["investigation-shared-beneficiary"],
      riskStatus: "FLAGGED",
    },
    ...networkSellers,
  ]);

  await RiskAssessment.create({
    targetSellerId: "investigation-target",
    evidence: { sharedBeneficiary: true },
    score: 35,
    decision: "REVIEW",
    findings: [
      {
        rule: "SHARED_BENEFICIARY",
        points: 35,
        description: "Test shared beneficiary",
      },
    ],
    explanation: ["Synthetic test finding"],
    disclaimer: "Synthetic test data only.",
  });
});

test("returns seller profile, flagged graph connection, and history", async () => {
  const response = await fetch(
    `${baseUrl}/api/sellers/investigation-target/investigation`,
    {
      headers: authHeaders(),
    }
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);

  const report = body.investigation;

  assert.equal(report.seller.sellerId, "investigation-target");
  assert.equal(report.seller.verificationStatus, "PENDING");
  assert.equal(report.graph.found, true);
  assert.equal(report.graph.flaggedConnectionCount, 1);

  assert.ok(
    report.graph.relatedSellerIds.includes("investigation-flagged")
  );

  assert.equal(report.recentAssessments.length, 1);
  assert.equal(report.recentAssessments[0].score, 35);
});

test("returns 404 for an unknown investigation seller", async () => {
  const response = await fetch(
    `${baseUrl}/api/sellers/investigation-unknown/investigation`,
    {
      headers: authHeaders(),
    }
  );

  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});

for (const scenario of NETWORK_CASES) {
  test(
    `classifies network evidence correctly for ${scenario.targetId}`,
    async () => {
      const response = await fetch(
        `${baseUrl}/api/sellers/${scenario.targetId}/investigation`,
        { headers: authHeaders() }
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.investigation.seller.riskStatus, scenario.targetRiskStatus);
      assert.equal(
        body.investigation.graph.connections[0].flaggedConnection,
        scenario.flaggedConnection
      );
      assert.ok(
        body.investigation.actionPlan.actions.some(
          (action) => action.id === scenario.actionId
        )
      );
      assert.equal(
        body.investigation.actionPlan.actions.some(
          (action) => action.id === "REVIEW_FLAGGED_NETWORK_CONNECTIONS"
        ),
        scenario.flaggedConnection
      );
    }
  );
}

test.after(async () => {
  try {
    await Seller.deleteMany({
      sellerId: { $in: TEST_SELLER_IDS },
    });

    await RiskAssessment.deleteMany({
      targetSellerId: { $in: TEST_SELLER_IDS },
    });
  } finally {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      await disconnectTestDatabase();
    }
  }
});

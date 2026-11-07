
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

const { default: RiskAssessment } =
  await import("../models/RiskAssessment.js");
const { default: app } = await import("../app.js");

const server = app.listen(0);
const baseUrl = await new Promise((resolve, reject) => {
  server.once("listening", () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
  server.once("error", reject);
});

const createdIds = [];

test.before(async () => {
  const first = await RiskAssessment.create({
    targetSellerId: "history-test-seller",
    evidence: { highTransactionVelocity: true },
    score: 25,
    decision: "ALLOW",
    findings: [
      {
        rule: "HIGH_TRANSACTION_VELOCITY",
        points: 25,
        description: "Test velocity signal",
      },
    ],
    explanation: ["Test assessment one"],
    disclaimer: "Synthetic test data only.",
  });

  createdIds.push(first._id);

  const second = await RiskAssessment.create({
    targetSellerId: "history-test-seller",
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
    explanation: ["Test assessment two"],
    disclaimer: "Synthetic test data only.",
  });

  createdIds.push(second._id);
});

test("retrieves an assessment by ID", async () => {
  const response = await fetch(
    `${baseUrl}/api/risk/assessments/${createdIds[0]}`,
    {
      headers: authHeaders(),
    }
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.assessment.score, 25);
  assert.equal(body.assessment.targetSellerId, "history-test-seller");
});

test("returns 404 for an unknown assessment ID", async () => {
  const response = await fetch(
    `${baseUrl}/api/risk/assessments/aaaaaaaaaaaaaaaaaaaaaaaa`,
    {
      headers: authHeaders(),
    }
  );

  assert.equal(response.status, 404);
});

test("returns seller history in newest-first order", async () => {
  const response = await fetch(
    `${baseUrl}/api/risk/sellers/history-test-seller/history`,
    {
      headers: authHeaders(),
    }
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.count, 2);
  assert.equal(body.assessments[0].score, 35);
  assert.equal(body.assessments[1].score, 25);
});

test.after(async () => {
  try {
    if (createdIds.length > 0) {
      await RiskAssessment.deleteMany({
        _id: { $in: createdIds },
      });
    }
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

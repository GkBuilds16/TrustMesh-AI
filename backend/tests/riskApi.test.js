
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
    const address = server.address();
    resolve(`http://127.0.0.1:${address.port}`);
  });

  server.once("error", reject);
});

test("risk API returns and persists an assessment for valid evidence", async () => {
  const response = await fetch(`${baseUrl}/api/risk/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      evidence: {
        sharedBeneficiary: true,
        highTransactionVelocity: true,
        unusualTransactionAmount: true,
      },
    }),
  });

  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.assessment.score, 80);
  assert.equal(data.assessment.decision, "BLOCK");
  assert.equal(data.assessment.findings.length, 3);
  assert.ok(data.assessment.assessmentId);
  assert.ok(data.assessment.createdAt);

  const saved = await RiskAssessment.findById(
    data.assessment.assessmentId
  ).lean();

  assert.ok(saved, "Assessment should exist in the test database");
  assert.equal(saved.score, 80);
  assert.equal(saved.decision, "BLOCK");
  assert.equal(saved.evidence.highTransactionVelocity, true);

  await RiskAssessment.deleteOne({ _id: saved._id });
});

test("risk API rejects non-Boolean evidence values", async () => {
  const response = await fetch(`${baseUrl}/api/risk/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      evidence: { sharedBeneficiary: "yes" },
    }),
  });

  assert.equal(response.status, 400);
});

test("risk API rejects unsupported evidence fields", async () => {
  const response = await fetch(`${baseUrl}/api/risk/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      evidence: { unknownSignal: true },
    }),
  });

  assert.equal(response.status, 400);
});

test("risk API rejects a missing evidence object", async () => {
  const response = await fetch(`${baseUrl}/api/risk/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
});

test.after(async () => {
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
});

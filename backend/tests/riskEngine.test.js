
import test from "node:test";
import assert from "node:assert/strict";

import { calculateRiskScore } from "../risk-engine/riskScorer.js";
import { decideRiskAction } from "../risk-engine/policyEngine.js";

test("baseline evidence produces ALLOW", () => {
  const result = calculateRiskScore({});

  assert.equal(result.score, 0);
  assert.deepEqual(result.findings, []);
  assert.equal(decideRiskAction(result.score), "ALLOW");
});

test("shared beneficiary produces REVIEW", () => {
  const result = calculateRiskScore({
    sharedBeneficiary: true,
  });

  assert.equal(result.score, 35);
  assert.equal(decideRiskAction(result.score), "REVIEW");
});

test("a target seller marked FLAGGED produces BLOCK without changing network relationship classification", () => {
  const result = calculateRiskScore({ sellerFlagged: true });

  assert.equal(result.score, 60);
  assert.equal(decideRiskAction(result.score), "BLOCK");
  assert.equal(result.findings[0].rule, "FLAGGED_SELLER");
});

test("multiple risk signals produce BLOCK", () => {
  const result = calculateRiskScore({
    sharedBeneficiary: true,
    highTransactionVelocity: true,
    unusualTransactionAmount: true,
  });

  assert.equal(result.score, 80);
  assert.equal(decideRiskAction(result.score), "BLOCK");
});

test("risk score is capped at 100", () => {
  const result = calculateRiskScore({
    sharedBeneficiary: true,
    highTransactionVelocity: true,
    unusualTransactionAmount: true,
    incompleteSellerVerification: true,
  });

  assert.equal(result.score, 90);
});

test("invalid risk scores are rejected", () => {
  assert.throws(() => decideRiskAction(-1));
  assert.throws(() => decideRiskAction(101));
  assert.throws(() => decideRiskAction(Number.NaN));
});

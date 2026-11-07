
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateTransaction } from "../risk-engine/riskService.js";

test("graph findings contribute to the risk assessment", () => {
  const result = evaluateTransaction({
    targetSellerId: "seller-A",
    sellers: [
      { id: "seller-A", beneficiaryIds: ["beneficiary-1"] },
      { id: "seller-B", beneficiaryIds: ["beneficiary-1"] },
    ],
    flaggedSellerIds: ["seller-B"],
  });

  assert.equal(result.score, 35);
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.graph.flaggedConnectionCount, 1);
  assert.equal(result.findings[0].rule, "SHARED_BENEFICIARY");
});

test("assessment still works without graph data", () => {
  const result = evaluateTransaction({
    evidence: { highTransactionVelocity: true },
  });

  assert.equal(result.score, 25);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.graph, null);
});

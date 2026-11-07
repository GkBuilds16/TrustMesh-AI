
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSellerGraph } from "../graph-engine/graphEngine.js";

const sellers = [
  { id: "seller-A", beneficiaryIds: ["beneficiary-1"] },
  { id: "seller-B", beneficiaryIds: ["beneficiary-1"] },
  { id: "seller-C", beneficiaryIds: ["beneficiary-2"] },
];

test("finds sellers sharing a beneficiary", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers,
    flaggedSellerIds: [],
  });

  assert.equal(result.found, true);
  assert.deepEqual(result.relatedSellerIds, ["seller-B"]);
  assert.deepEqual(result.riskSignals, []);
});

test("reports a connection to a flagged seller", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers,
    flaggedSellerIds: ["seller-B"],
  });

  assert.equal(result.flaggedConnectionCount, 1);
  assert.equal(
    result.riskSignals[0].type,
    "SHARED_BENEFICIARY_WITH_FLAGGED_SELLER"
  );
  assert.deepEqual(
    result.riskSignals[0].relatedSellerIds,
    ["seller-B"]
  );
});

test("returns found false for an unknown seller", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-unknown",
    sellers,
    flaggedSellerIds: [],
  });

  assert.equal(result.found, false);
  assert.deepEqual(result.relatedSellerIds, []);
  assert.deepEqual(result.riskSignals, []);
});

test("rejects an empty target seller ID", () => {
  assert.throws(() =>
    analyzeSellerGraph({
      targetSellerId: "",
      sellers,
      flaggedSellerIds: [],
    })
  );
});

test("does not connect sellers with different beneficiaries", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-C",
    sellers,
    flaggedSellerIds: [],
  });

  assert.deepEqual(result.relatedSellerIds, []);
  assert.equal(result.flaggedConnectionCount, 0);
});

test("does not connect a seller to itself", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers,
    flaggedSellerIds: [],
  });

  assert.equal(
    result.relatedSellerIds.includes("seller-A"),
    false
  );
});

test("detects multiple sellers sharing the target beneficiary", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers: [
      { id: "seller-A", beneficiaryIds: ["beneficiary-1"] },
      { id: "seller-B", beneficiaryIds: ["beneficiary-1"] },
      { id: "seller-D", beneficiaryIds: ["beneficiary-1"] },
      { id: "seller-C", beneficiaryIds: ["beneficiary-2"] },
    ],
    flaggedSellerIds: [],
  });

  assert.deepEqual(result.relatedSellerIds, [
    "seller-B",
    "seller-D",
  ]);
});

test("does not flag a seller merely because an unrelated seller is flagged", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers,
    flaggedSellerIds: ["seller-C"],
  });

  assert.deepEqual(result.relatedSellerIds, ["seller-B"]);
  assert.equal(result.flaggedConnectionCount, 0);
  assert.deepEqual(result.riskSignals, []);
});

test("handles sellers with no beneficiary IDs", () => {
  const result = analyzeSellerGraph({
    targetSellerId: "seller-A",
    sellers: [
      { id: "seller-A", beneficiaryIds: [] },
      { id: "seller-B", beneficiaryIds: [] },
    ],
    flaggedSellerIds: [],
  });

  assert.deepEqual(result.relatedSellerIds, []);
});


import test from "node:test";
import assert from "node:assert/strict";

import {
  generateInvestigationActionPlan,
} from "../services/investigationActionPlanService.js";

const verifiedSeller = {
  sellerId: "seller-100",
  verificationStatus: "VERIFIED",
};

test("recommends identity verification for an unverified seller", () => {
  const plan = generateInvestigationActionPlan({
    seller: {
      ...verifiedSeller,
      verificationStatus: "UNVERIFIED",
    },
    graph: {},
  });

  assert.ok(
    plan.actions.some(
      (action) => action.id === "VERIFY_SELLER_IDENTITY"
    )
  );

  assert.equal(plan.actions[0].priority, "HIGH");
});

test("prioritizes investigation of a flagged shared-beneficiary connection", () => {
  const plan = generateInvestigationActionPlan({
    seller: verifiedSeller,
    graph: {
      relatedSellers: [
        { sellerId: "seller-200" },
      ],
      connections: [
        {
          targetSellerId: "seller-200",
          relationship: "SHARED_BENEFICIARY",
          sharedBeneficiaryIds: ["beneficiary-1"],
          evidenceAvailable: true,
          flaggedConnection: true,
        },
      ],
    },
  });

  const action = plan.actions.find(
    (item) => item.id === "REVIEW_FLAGGED_NETWORK_CONNECTIONS"
  );

  assert.ok(action);
  assert.equal(action.priority, "HIGH");
  assert.deepEqual(
    action.evidence.connections[0].sharedBeneficiaryIds,
    ["beneficiary-1"]
  );
});

test("does not recommend a flagged connection without supporting evidence", () => {
  const plan = generateInvestigationActionPlan({
    seller: verifiedSeller,
    graph: {
      relatedSellers: [{ sellerId: "seller-200" }],
      connections: [
        {
          targetSellerId: "seller-200",
          relationship: "SHARED_BENEFICIARY",
          sharedBeneficiaryIds: [],
          evidenceAvailable: false,
          flaggedConnection: true,
        },
      ],
    },
  });

  assert.ok(
    !plan.actions.some(
      (action) =>
        action.id === "REVIEW_FLAGGED_NETWORK_CONNECTIONS"
    )
  );
});

test("recommends reviewing transaction velocity when the latest assessment contains that finding", () => {
  const plan = generateInvestigationActionPlan({
    seller: verifiedSeller,
    graph: {},
    recentAssessments: [
      {
        _id: "assessment-1",
        findings: [
          { rule: "HIGH_TRANSACTION_VELOCITY" },
        ],
      },
    ],
  });

  assert.ok(
    plan.actions.some(
      (action) => action.id === "REVIEW_TRANSACTION_VELOCITY"
    )
  );
});

test("recommends a standard review when no configured action is triggered", () => {
  const plan = generateInvestigationActionPlan({
    seller: verifiedSeller,
    graph: {},
    recentAssessments: [],
  });

  assert.equal(plan.actions.length, 1);
  assert.equal(
    plan.actions[0].id,
    "COMPLETE_STANDARD_REVIEW"
  );
});

test("rejects a missing seller record", () => {
  assert.throws(
    () => generateInvestigationActionPlan({ graph: {} }),
    /valid seller record/
  );
});

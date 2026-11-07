
import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import { resolve } from "node:path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

dotenv.config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});

const { disconnectTestDatabase } =
  await import("./testDatabaseLifecycle.js");

const { default: User } = await import("../models/User.js");
const { default: Seller } = await import("../models/Seller.js");
const { default: InvestigationCase } =
  await import("../models/InvestigationCase.js");
  const { default: InvestigationCaseAudit } =
  await import("../models/InvestigationCaseAudit.js");
const { default: app } = await import("../app.js");

const {
  setAuditWriterForTests,
} = await import("../services/investigationCaseService.js");

const TEST_EMAIL = "investigation-case-test@example.com";
const TEST_SELLER_ID = "case-api-test-seller";
const TEST_CASE_ACTION_ID = "case-api-test-action";

let testUser;
let authHeaders;
let secondUser;
let secondAuthHeaders;
let server;
let baseUrl;

function createToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: "ANALYST",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "trustmesh-ai",
      audience: "trustmesh-ai-app",
    }
  );
}

async function request(path, options = {}, headers = authHeaders) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...headers,
    },
  });
}


async function createCase(
  actionId = TEST_CASE_ACTION_ID,
  headers = authHeaders
) {
  return request(
    "/api/investigation-cases",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellerId: TEST_SELLER_ID,
        action: {
          id: actionId,
          title: "Verify test seller identity",
          priority: "HIGH",
        },
      }),
    },
    headers
  );
}


test.before(async () => {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "REPLACE_WITH_A_LONG_RANDOM_SECRET"
  ) {
    throw new Error("Configure JWT_SECRET in backend/.env.test");
  }

  server = app.listen(0);
  baseUrl = await new Promise((resolve, reject) => {
    server.once("listening", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
    server.once("error", reject);
  });

  await InvestigationCase.deleteMany({
    sellerId: TEST_SELLER_ID,
  });
  await InvestigationCaseAudit.deleteMany({
  sellerId: TEST_SELLER_ID,
});
  await Seller.deleteMany({ sellerId: TEST_SELLER_ID });
  await User.deleteMany({
    email: {
      $in: [
        TEST_EMAIL,
        "investigation-case-second@example.com",
      ],
    },
  });

  testUser = await User.create({
    name: "Investigation Case Test Analyst",
    email: TEST_EMAIL,
    passwordHash: await bcrypt.hash("TestPassword!2026", 12),
    role: "ANALYST",
  });

  secondUser = await User.create({
    name: "Second Investigation Test Analyst",
    email: "investigation-case-second@example.com",
    passwordHash: await bcrypt.hash("TestPassword!2026", 12),
    role: "ANALYST",
  });

  authHeaders = {
    Authorization: `Bearer ${createToken(testUser)}`,
  };
  secondAuthHeaders = {
    Authorization: `Bearer ${createToken(secondUser)}`,
  };

  await Seller.create({
    sellerId: TEST_SELLER_ID,
    displayName: "Case API Test Seller",
    beneficiaryIds: [],
    verificationStatus: "UNVERIFIED",
    riskStatus: "UNASSESSED",
  });
});

test("persists audit events for case creation and updates", async () => {
    const createResponse = await createCase("audit-persistence-test-action");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const creationAudit = await InvestigationCaseAudit.find({
    caseId: created.case._id,
  }).lean();

  assert.equal(creationAudit.length, 1);
  assert.equal(creationAudit[0].eventType, "CASE_CREATED");
  assert.equal(creationAudit[0].actorId.toString(), testUser._id.toString());
  assert.equal(creationAudit[0].newStatus, "OPEN");

  const updateResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        resolutionNotes: "Audit test notes.",
      }),
    }
  );

  assert.equal(updateResponse.status, 200);

  const auditEvents = await InvestigationCaseAudit.find({
    caseId: created.case._id,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  assert.equal(auditEvents.length, 3);

  assert.equal(auditEvents[1].eventType, "STATUS_CHANGED");
  assert.equal(auditEvents[1].previousStatus, "OPEN");
  assert.equal(auditEvents[1].newStatus, "IN_PROGRESS");

  assert.equal(auditEvents[2].eventType, "NOTES_UPDATED");
  assert.equal(auditEvents[2].notesChanged, true);

  assert.ok(
    auditEvents.every(
      (event) => event.actorId.toString() === testUser._id.toString()
    )
  );

  assert.ok(
    auditEvents.every(
      (event) => !Object.hasOwn(event, "resolutionNotes")
    )
  );
});


test("creates a case and retrieves it", async () => {
  const createResponse = await createCase();
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(created.success, true);
  assert.equal(created.case.sellerId, TEST_SELLER_ID);
  assert.equal(created.case.actionId, TEST_CASE_ACTION_ID);
  assert.equal(created.case.status, "OPEN");

  const listResponse = await request("/api/investigation-cases");
  const list = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.ok(
    list.cases.some((item) => item._id === created.case._id)
  );
});

test("updates case status and persists investigation notes", async () => {
  const createResponse = await createCase();
  const created = await createResponse.json();

  const updateResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        resolutionNotes: "Review started.",
      }),
    }
  );
  const updated = await updateResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updated.case.status, "IN_PROGRESS");
  assert.equal(updated.case.resolutionNotes, "Review started.");

  const persisted = await InvestigationCase.findById(
    created.case._id
  ).lean();

  assert.equal(persisted.status, "IN_PROGRESS");
  assert.equal(persisted.resolutionNotes, "Review started.");
});

test("resolves a case and prevents reopening", async () => {
  const createResponse = await createCase();
  const created = await createResponse.json();

  const resolveResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "RESOLVED",
        resolutionNotes: "Review completed.",
      }),
    }
  );
  const resolved = await resolveResponse.json();

  assert.equal(resolveResponse.status, 200);
  assert.equal(resolved.case.status, "RESOLVED");
  assert.ok(resolved.case.resolvedAt);

  const reopenResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    }
  );

  assert.equal(reopenResponse.status, 409);
});


test("does not create audit events for unchanged case data", async () => {
  const createResponse = await createCase("audit-noop-test-action");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const beforeCount = await InvestigationCaseAudit.countDocuments({
    caseId: created.case._id,
  });

  const updateResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "OPEN",
        resolutionNotes: "",
      }),
    }
  );

  assert.equal(updateResponse.status, 200);

  const afterCount = await InvestigationCaseAudit.countDocuments({
    caseId: created.case._id,
  });

  assert.equal(beforeCount, 1);
  assert.equal(afterCount, beforeCount);
});


test("does not add audit events when reopening a resolved case is rejected", async () => {
  const createResponse = await createCase("audit-reopen-rejection-test");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const resolveResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "RESOLVED",
        resolutionNotes: "Completed review.",
      }),
    }
  );

  assert.equal(resolveResponse.status, 200);

  const beforeCount = await InvestigationCaseAudit.countDocuments({
    caseId: created.case._id,
  });

  const reopenResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        resolutionNotes: "Attempt to reopen.",
      }),
    }
  );

  assert.equal(reopenResponse.status, 409);

  const afterCount = await InvestigationCaseAudit.countDocuments({
    caseId: created.case._id,
  });

  const persistedCase = await InvestigationCase.findById(
    created.case._id
  ).lean();

  assert.equal(afterCount, beforeCount);
  assert.equal(persistedCase.status, "RESOLVED");
  assert.equal(persistedCase.resolutionNotes, "Completed review.");
});


test("rolls back a case update when the audit write fails", async () => {
  const createResponse = await createCase("audit-rollback-test-action");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const caseId = created.case._id;

  const beforeCase = await InvestigationCase.findById(caseId).lean();
  const beforeAuditCount = await InvestigationCaseAudit.countDocuments({
    caseId,
  });

  const restoreAuditWriter = setAuditWriterForTests(async () => {
    throw new Error("Simulated audit storage failure");
  });

  try {
    const updateResponse = await request(
      `/api/investigation-cases/${caseId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "IN_PROGRESS",
          resolutionNotes: "These notes must not persist.",
        }),
      }
    );

    assert.equal(updateResponse.status, 500);

    const afterCase = await InvestigationCase.findById(caseId).lean();
    const afterAuditCount = await InvestigationCaseAudit.countDocuments({
      caseId,
    });

    assert.equal(afterCase.status, beforeCase.status);
    assert.equal(afterCase.resolutionNotes, beforeCase.resolutionNotes);
    assert.equal(afterAuditCount, beforeAuditCount);
  } finally {
    restoreAuditWriter();
  }
});



test("records case resolution in the audit history", async () => {
  const createResponse = await createCase("audit-resolution-test-action");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const resolveResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "RESOLVED",
        resolutionNotes: "Resolution audit test.",
      }),
    }
  );

  assert.equal(resolveResponse.status, 200);

  const events = await InvestigationCaseAudit.find({
    caseId: created.case._id,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  assert.equal(events.length, 3);

  const resolutionEvent = events.find(
    (event) => event.eventType === "CASE_RESOLVED"
  );

  assert.ok(resolutionEvent);
  assert.equal(resolutionEvent.previousStatus, "OPEN");
  assert.equal(resolutionEvent.newStatus, "RESOLVED");
  assert.equal(
    resolutionEvent.actorId.toString(),
    testUser._id.toString()
  );

  const notesEvent = events.find(
    (event) => event.eventType === "NOTES_UPDATED"
  );

  assert.ok(notesEvent);
  assert.equal(notesEvent.notesChanged, true);
  assert.ok(resolutionEvent.createdAt);
});


test("does not create duplicate cases for the same analyst and action", async () => {
  const firstResponse = await createCase();
  const first = await firstResponse.json();

  const duplicateResponse = await createCase();
  const duplicate = await duplicateResponse.json();

  assert.equal(firstResponse.status, 201);
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicate.case._id, first.case._id);

  const count = await InvestigationCase.countDocuments({
    createdBy: testUser._id,
    sellerId: TEST_SELLER_ID,
    actionId: TEST_CASE_ACTION_ID,
  });

  assert.equal(count, 1);
});


test("returns audit history only to the case owner", async () => {
  const createResponse = await createCase("audit-api-owner-test");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const response = await request(
    `/api/investigation-cases/${created.case._id}/audit`
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.events));
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].eventType, "CASE_CREATED");
  assert.equal(
    data.events[0].actorId.toString(),
    testUser._id.toString()
  );

  const otherAnalystResponse = await request(
    `/api/investigation-cases/${created.case._id}/audit`,
    {},
    secondAuthHeaders
  );

  assert.equal(otherAnalystResponse.status, 404);
});

test("rejects unauthenticated audit-history requests", async () => {
  const createResponse = await createCase("audit-api-auth-test");
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);

  const response = await request(
    `/api/investigation-cases/${created.case._id}/audit`,
    {},
    {}
  );

  assert.equal(response.status, 401);
});


test("rejects unauthenticated access to investigation cases", async () => {
  const listResponse = await request(
    "/api/investigation-cases",
    {},
    {}
  );

  assert.equal(listResponse.status, 401);

  const createResponse = await request(
    "/api/investigation-cases",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellerId: TEST_SELLER_ID,
        action: {
          id: "unauthenticated-action",
          title: "Attempt unauthorized case creation",
          priority: "HIGH",
        },
      }),
    },
    {}
  );

  assert.equal(createResponse.status, 401);
});

test("allows separate analysts to own cases for the same action", async () => {
  const firstResponse = await createCase();
  const first = await firstResponse.json();

  const secondResponse = await createCase(
    TEST_CASE_ACTION_ID,
    secondAuthHeaders
  );
  const second = await secondResponse.json();

  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 201);

  assert.notEqual(first.case._id, second.case._id);
  assert.notEqual(
    first.case.createdBy,
    second.case.createdBy
  );

  const firstListResponse = await request(
    "/api/investigation-cases",
    {},
    authHeaders
  );
  const firstList = await firstListResponse.json();

  const secondListResponse = await request(
    "/api/investigation-cases",
    {},
    secondAuthHeaders
  );
  const secondList = await secondListResponse.json();

  assert.ok(
    firstList.cases.some(
      (item) => item._id === first.case._id
    )
  );
  assert.ok(
    !firstList.cases.some(
      (item) => item._id === second.case._id
    )
  );

  assert.ok(
    secondList.cases.some(
      (item) => item._id === second.case._id
    )
  );
  assert.ok(
    !secondList.cases.some(
      (item) => item._id === first.case._id
    )
  );
});

test("does not expose another analyst's cases", async () => {
  const createResponse = await createCase();
  const created = await createResponse.json();

  const listResponse = await request(
    "/api/investigation-cases",
    {},
    secondAuthHeaders
  );
  const list = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(
    list.cases.some((item) => item._id === created.case._id),
    false
  );

  const updateResponse = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    },
    secondAuthHeaders
  );

  assert.equal(updateResponse.status, 404);
});

test("rejects an invalid status", async () => {
  const createResponse = await createCase();
  const created = await createResponse.json();

  const response = await request(
    `/api/investigation-cases/${created.case._id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "BLOCKED" }),
    }
  );

  assert.equal(response.status, 400);
});

test("returns 404 when creating a case for a nonexistent seller", async () => {
  const response = await request("/api/investigation-cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellerId: "case-api-missing-seller",
      action: {
        id: "missing-seller-action",
        title: "Investigate missing seller",
        priority: "HIGH",
      },
    }),
  });

  assert.equal(response.status, 404);
});

test.after(async () => {
  try {
    await InvestigationCase.deleteMany({
      sellerId: TEST_SELLER_ID,
    });
    await InvestigationCaseAudit.deleteMany({
  sellerId: TEST_SELLER_ID,
});
    await Seller.deleteMany({ sellerId: TEST_SELLER_ID });

    if (testUser?._id || secondUser?._id) {
      await User.deleteMany({
        _id: {
          $in: [testUser?._id, secondUser?._id].filter(Boolean),
        },
      });
    }
  } finally {
    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    } finally {
      await disconnectTestDatabase();
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});

const { disconnectTestDatabase } =
  await import("./testDatabaseLifecycle.js");
const { default: mongoose } = await import("mongoose");
const { default: User } = await import("../models/User.js");
const { default: Seller } = await import("../models/Seller.js");
const { default: RiskAssessment } =
  await import("../models/RiskAssessment.js");
const { default: InvestigationCase } =
  await import("../models/InvestigationCase.js");
const { default: InvestigationCaseAudit } =
  await import("../models/InvestigationCaseAudit.js");
const { default: app } = await import("../app.js");
const jwt = await import("jsonwebtoken");

const SELLER_ID = "shared-workspace-authz-seller";
const ANALYST_A_EMAIL = "shared-workspace-analyst-a@example.com";
const ANALYST_B_EMAIL = "shared-workspace-analyst-b@example.com";
const ESCALATION_EMAIL = "shared-workspace-role-escalation@example.com";

let analystA;
let analystB;
let tokenA;
let tokenB;
let seller;
let assessmentId;
let caseA;
let caseB;
let server;
let baseUrl;

function createToken(user) {
  return jwt.default.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: "trustmesh-ai",
      audience: "trustmesh-ai-app",
    }
  );
}

async function request(path, { token, method = "GET", body } = {}) {
  const headers = {};

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return {
    response,
    data: await response.json(),
  };
}

test.before(async () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("Configure JWT_SECRET in backend/.env.test");
  }

  await Seller.deleteMany({ sellerId: SELLER_ID });
  await RiskAssessment.deleteMany({ targetSellerId: SELLER_ID });
  await InvestigationCase.deleteMany({ sellerId: SELLER_ID });
  await InvestigationCaseAudit.deleteMany({ sellerId: SELLER_ID });
  await User.deleteMany({
    email: {
      $in: [ANALYST_A_EMAIL, ANALYST_B_EMAIL, ESCALATION_EMAIL],
    },
  });

  analystA = await User.create({
    name: "Shared Workspace Analyst A",
    email: ANALYST_A_EMAIL,
    passwordHash: await bcrypt.hash("WorkspaceTestPassword!2026", 12),
    role: "ANALYST",
  });
  analystB = await User.create({
    name: "Shared Workspace Analyst B",
    email: ANALYST_B_EMAIL,
    passwordHash: await bcrypt.hash("WorkspaceTestPassword!2026", 12),
    role: "ANALYST",
  });

  tokenA = createToken(analystA);
  tokenB = createToken(analystB);

  server = app.listen(0, "127.0.0.1");
  baseUrl = await new Promise((resolve, reject) => {
    server.once("listening", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
    server.once("error", reject);
  });
});

test("analyst A creates a seller in the shared workspace", async () => {
  const { response, data } = await request("/api/sellers", {
    token: tokenA,
    method: "POST",
    body: {
      sellerId: SELLER_ID,
      displayName: "Shared Workspace Seller",
      beneficiaryIds: ["shared-workspace-beneficiary"],
      verificationStatus: "PENDING",
    },
  });

  assert.equal(response.status, 201);
  assert.equal(data.seller.sellerId, SELLER_ID);
  seller = data.seller;
});

test("analyst B can list and retrieve analyst A's seller", async () => {
  const listResult = await request("/api/sellers", { token: tokenB });
  assert.equal(listResult.response.status, 200);
  assert.ok(
    listResult.data.sellers.some((item) => item.sellerId === SELLER_ID)
  );

  const detailResult = await request(`/api/sellers/${SELLER_ID}`, {
    token: tokenB,
  });
  assert.equal(detailResult.response.status, 200);
  assert.equal(detailResult.data.seller.displayName, "Shared Workspace Seller");
});

test("analyst B can access shared seller investigation information", async () => {
  const { response, data } = await request(
    `/api/sellers/${SELLER_ID}/investigation`,
    { token: tokenB }
  );

  assert.equal(response.status, 200);
  assert.equal(data.investigation.seller.sellerId, SELLER_ID);
  assert.equal(data.investigation.seller.riskStatus, "UNASSESSED");
  assert.ok(Array.isArray(data.investigation.graph.connections));
});

test("analyst B can retrieve analyst A's shared assessment and history", async () => {
  const created = await request("/api/risk/evaluate", {
    token: tokenA,
    method: "POST",
    body: {
      targetSellerId: SELLER_ID,
      evidence: { highTransactionVelocity: true },
    },
  });

  assert.equal(created.response.status, 200);
  assessmentId = created.data.assessment.assessmentId;

  const detail = await request(`/api/risk/assessments/${assessmentId}`, {
    token: tokenB,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.assessment.targetSellerId, SELLER_ID);
  assert.equal(detail.data.assessment.score, 25);

  const history = await request(
    `/api/risk/assessments?page=1&limit=50&targetSellerId=${SELLER_ID}`,
    { token: tokenB }
  );
  assert.equal(history.response.status, 200);
  assert.ok(
    history.data.assessments.some(
      (item) => item._id === assessmentId
    )
  );

  const sellerHistory = await request(
    `/api/risk/sellers/${SELLER_ID}/history`,
    { token: tokenB }
  );
  assert.equal(sellerHistory.response.status, 200);
  assert.ok(
    sellerHistory.data.assessments.some(
      (item) => item._id === assessmentId
    )
  );
});

test("case creation and duplicate prevention stay scoped to each analyst", async () => {
  const action = {
    id: "shared-workspace-action",
    title: "Review shared workspace seller",
    priority: "HIGH",
  };

  const createdA = await request("/api/investigation-cases", {
    token: tokenA,
    method: "POST",
    body: { sellerId: SELLER_ID, action },
  });
  assert.equal(createdA.response.status, 201);
  caseA = createdA.data.case;
  assert.equal(caseA.createdBy, analystA._id.toString());

  const createdAudit = await InvestigationCaseAudit.find({
    caseId: caseA._id,
  }).lean();
  assert.equal(createdAudit.length, 1);
  assert.equal(createdAudit[0].actorId.toString(), analystA._id.toString());

  const createdB = await request("/api/investigation-cases", {
    token: tokenB,
    method: "POST",
    body: { sellerId: SELLER_ID, action },
  });
  assert.equal(createdB.response.status, 201);
  caseB = createdB.data.case;
  assert.notEqual(caseA._id, caseB._id);
  assert.equal(caseB.createdBy, analystB._id.toString());
});

test("analyst B cannot list, retrieve, update, resolve, or read audit for A's case", async () => {
  const list = await request("/api/investigation-cases", {
    token: tokenB,
  });
  assert.equal(list.response.status, 200);
  assert.ok(!list.data.cases.some((item) => item._id === caseA._id));
  assert.ok(list.data.cases.some((item) => item._id === caseB._id));

  const guessedRead = await request(`/api/investigation-cases/${caseA._id}`, {
    token: tokenB,
  });
  assert.equal(guessedRead.response.status, 404);

  const beforeAuditCount = await InvestigationCaseAudit.countDocuments({
    caseId: caseA._id,
  });

  for (const status of ["IN_PROGRESS", "RESOLVED"]) {
    const rejectedUpdate = await request(
      `/api/investigation-cases/${caseA._id}`,
      {
        token: tokenB,
        method: "PATCH",
        body: { status, resolutionNotes: "Cross-owner attempt" },
      }
    );
    assert.equal(rejectedUpdate.response.status, 404);
  }

  const privateAudit = await request(
    `/api/investigation-cases/${caseA._id}/audit`,
    { token: tokenB }
  );
  assert.equal(privateAudit.response.status, 404);

  const persisted = await InvestigationCase.findById(caseA._id).lean();
  assert.equal(persisted.status, "OPEN");
  assert.equal(persisted.resolutionNotes, "");
  assert.equal(
    await InvestigationCaseAudit.countDocuments({ caseId: caseA._id }),
    beforeAuditCount
  );
});

test("analyst A can update and resolve their case, and analyst B cannot reopen it", async () => {
  const update = await request(`/api/investigation-cases/${caseA._id}`, {
    token: tokenA,
    method: "PATCH",
    body: {
      status: "IN_PROGRESS",
      resolutionNotes: "Analyst A began review.",
    },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.data.case.status, "IN_PROGRESS");

  const resolveCase = await request(`/api/investigation-cases/${caseA._id}`, {
    token: tokenA,
    method: "PATCH",
    body: {
      status: "RESOLVED",
      resolutionNotes: "Analyst A completed review.",
    },
  });
  assert.equal(resolveCase.response.status, 200);
  assert.equal(resolveCase.data.case.status, "RESOLVED");

  const beforeReopenAuditCount = await InvestigationCaseAudit.countDocuments({
    caseId: caseA._id,
  });
  const rejectedReopen = await request(
    `/api/investigation-cases/${caseA._id}`,
    {
      token: tokenB,
      method: "PATCH",
      body: { status: "IN_PROGRESS" },
    }
  );
  assert.equal(rejectedReopen.response.status, 404);
  assert.equal(
    await InvestigationCaseAudit.countDocuments({ caseId: caseA._id }),
    beforeReopenAuditCount
  );

  const ownerAudit = await request(
    `/api/investigation-cases/${caseA._id}/audit`,
    { token: tokenA }
  );
  assert.equal(ownerAudit.response.status, 200);
  assert.ok(ownerAudit.data.events.length >= 3);
  assert.ok(
    ownerAudit.data.events.every(
      (event) => event.actorId.toString() === analystA._id.toString()
    )
  );
});

test("unauthenticated and invalid-token requests cannot access shared resources", async () => {
  for (const path of ["/api/sellers", "/api/risk/assessments"]) {
    const unauthenticated = await request(path);
    assert.equal(unauthenticated.response.status, 401);

    const invalidToken = await request(path, { token: "invalid.jwt.value" });
    assert.equal(invalidToken.response.status, 401);
  }
});

test("public registration cannot assign ADMIN", async () => {
  const { response, data } = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Escalation Attempt",
      email: ESCALATION_EMAIL,
      password: "WorkspaceTestPassword!2026",
      role: "ADMIN",
    },
  });

  assert.equal(response.status, 201);
  assert.equal(data.user.role, "ANALYST");
  assert.equal(Object.hasOwn(data.user, "passwordHash"), false);
  assert.equal(jwt.default.decode(data.token).role, "ANALYST");
});

test.after(async () => {
  try {
    await InvestigationCase.deleteMany({ sellerId: SELLER_ID });
    await InvestigationCaseAudit.deleteMany({ sellerId: SELLER_ID });
    await RiskAssessment.deleteMany({ targetSellerId: SELLER_ID });
    await Seller.deleteMany({ sellerId: SELLER_ID });
    await User.deleteMany({
      email: {
        $in: [ANALYST_A_EMAIL, ANALYST_B_EMAIL, ESCALATION_EMAIL],
      },
    });
  } finally {
    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      if (mongoose.connection.readyState !== 0) {
        await disconnectTestDatabase();
      }
    }
  }
});

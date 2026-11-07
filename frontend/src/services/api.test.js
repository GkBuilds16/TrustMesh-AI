import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { login } from "./auth";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("frontend API integration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("uses authenticated shared seller and assessment endpoints", async () => {
    sessionStorage.setItem("trustmesh_token", "analyst-a-token");
    fetch
      .mockResolvedValueOnce(jsonResponse({ sellers: [{ sellerId: "seller-a" }] }))
      .mockResolvedValueOnce(jsonResponse({ assessments: [{ _id: "risk-a" }], pagination: {} }));

    const sellers = await api.getSellers();
    const history = await api.getAssessmentHistory(1, 10);

    expect(sellers.sellers[0].sellerId).toBe("seller-a");
    expect(history.assessments[0]._id).toBe("risk-a");
    expect(fetch.mock.calls[0][0]).toMatch(/\/sellers$/);
    expect(fetch.mock.calls[1][0]).toContain("/risk/assessments?");
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer analyst-a-token");
    }
  });

  it("keeps cases and audit on authenticated owner-scoped API routes", async () => {
    sessionStorage.setItem("trustmesh_token", "analyst-b-token");
    fetch
      .mockResolvedValueOnce(jsonResponse({ cases: [{ _id: "case-b" }] }))
      .mockResolvedValueOnce(jsonResponse({ events: [{ _id: "event-b" }] }));

    expect((await api.getInvestigationCases()).cases[0]._id).toBe("case-b");
    expect((await api.getInvestigationCaseAudit("case-b")).events[0]._id).toBe("event-b");
    expect(fetch.mock.calls[0][0]).toMatch(/\/investigation-cases$/);
    expect(fetch.mock.calls[1][0]).toContain("/investigation-cases/case-b/audit");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer analyst-b-token");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer analyst-b-token");
  });

  it("clears the expired session and emits an unauthorized event on 401", async () => {
    sessionStorage.setItem("trustmesh_token", "expired-token");
    sessionStorage.setItem("trustmesh_user", JSON.stringify({ id: "analyst-a" }));
    const unauthorized = vi.fn();
    window.addEventListener("trustmesh:unauthorized", unauthorized);
    fetch.mockResolvedValueOnce(jsonResponse({ message: "Unauthenticated." }, 401));

    await expect(api.getSellers()).rejects.toThrow(/sign in again/i);

    expect(sessionStorage.getItem("trustmesh_token")).toBeNull();
    expect(sessionStorage.getItem("trustmesh_user")).toBeNull();
    expect(unauthorized).toHaveBeenCalledOnce();
    window.removeEventListener("trustmesh:unauthorized", unauthorized);
  });

  it("keeps login public and returns the backend authentication response", async () => {
    const result = { token: "new-token", user: { id: "analyst-a", role: "ANALYST" } };
    fetch.mockResolvedValueOnce(jsonResponse(result));

    await expect(login("analyst@example.test", "valid-password")).resolves.toEqual(result);
    expect(fetch.mock.calls[0][0]).toContain("/auth/login");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("creates an authenticated payment with its idempotency key and reads analyst review summaries", async () => {
    sessionStorage.setItem("trustmesh_token", "analyst-payment-token");
    fetch.mockResolvedValueOnce(jsonResponse({ payment: { status: "REVIEW_REQUIRED" } }))
      .mockResolvedValueOnce(jsonResponse({ payments: [{ status: "REVIEW_REQUIRED" }] }));

    const created = await api.createPayment({ sellerId: "shared-seller", amount: "15.20", currency: "USD" }, "payment-key-123");
    const queue = await api.getPaymentReviewQueue();

    expect(created.payment.status).toBe("REVIEW_REQUIRED");
    expect(queue.payments).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toMatch(/\/payments$/);
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("payment-key-123");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer analyst-payment-token");
    expect(fetch.mock.calls[1][0]).toContain("/payments/review-queue");
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const sharedSeller = {
  _id: "seller-record-1",
  sellerId: "shared-seller-1",
  displayName: "Shared Merchant",
  verificationStatus: "VERIFIED",
  riskStatus: "UNASSESSED",
};

function setSession() {
  sessionStorage.setItem("trustmesh_token", "analyst-token");
  sessionStorage.setItem("trustmesh_user", JSON.stringify({ id: "analyst-1", name: "Analyst One", role: "ANALYST" }));
}

describe("shared workspace dashboard", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setSession();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders shared seller and risk data and the advisory decision language", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).endsWith("/health")) return Promise.resolve(response({ success: true }));
      if (String(url).endsWith("/sellers")) return Promise.resolve(response({ sellers: [sharedSeller] }));
      if (String(url).includes("/risk/assessments?")) {
        return Promise.resolve(response({
          assessments: [{
            _id: "assessment-shared-1",
            decision: "ALLOW",
            score: 0,
            findings: [],
            evidence: { sharedBeneficiary: false },
            explanation: [],
            targetSellerId: "shared-seller-1",
          }],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        }));
      }
      if (String(url).endsWith("/investigation-cases")) return Promise.resolve(response({ cases: [] }));
      return Promise.resolve(response({}));
    }));

    render(<App />);
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe("#overview");
    expect(await screen.findByText("Shared Merchant")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /view details/i }));
    expect(await screen.findByText(/Assessment ID: assessment-shared-1/)).toBeTruthy();
    expect(screen.getByText("Shared seller records, verification status, and risk status available to all authenticated analysts.")).toBeTruthy();
    expect(screen.getByText(/do not independently block paypal/i)).toBeTruthy();
    expect(screen.getByText("ALLOW")).toBeTruthy();
  });

  it("returns to sign-in and clears shared UI state when the API rejects an expired token", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).endsWith("/health")) return Promise.resolve(response({ success: true }));
      if (String(url).endsWith("/sellers")) return Promise.resolve(response({ message: "Unauthenticated." }, 401));
      if (String(url).includes("/risk/assessments?")) return Promise.resolve(response({ assessments: [], pagination: {} }));
      if (String(url).endsWith("/investigation-cases")) return Promise.resolve(response({ cases: [] }));
      return Promise.resolve(response({}));
    }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    await waitFor(() => {
      expect(sessionStorage.getItem("trustmesh_token")).toBeNull();
      expect(sessionStorage.getItem("trustmesh_user")).toBeNull();
    });
  });
});

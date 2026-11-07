import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvestigationCases from "./InvestigationCases";

const record = {
  _id: "case-a",
  sellerId: "seller-a",
  actionTitle: "Review shared beneficiary",
  priority: "HIGH",
  status: "OPEN",
  resolutionNotes: "Check source records",
};

describe("personal investigation workspace", () => {
  afterEach(cleanup);

  it("shows a loading state and then the analyst's own cases with ownership", async () => {
    let resolveCases;
    const getInvestigationCases = vi.fn(() => new Promise((resolve) => { resolveCases = resolve; }));
    const api = { getInvestigationCases };
    render(<InvestigationCases api={api} ownerName="Analyst A" />);

    await waitFor(() => expect(getInvestigationCases).toHaveBeenCalledOnce());
    expect(screen.getByText("Loading your cases...")).toBeTruthy();
    resolveCases({ cases: [record] });

    expect(await screen.findByText("Review shared beneficiary")).toBeTruthy();
    expect(screen.getByText(/owned by analyst a/i)).toBeTruthy();
    expect(screen.getByText(/only you can view or update/i)).toBeTruthy();
    expect(getInvestigationCases).toHaveBeenCalledWith();
  });

  it("shows an empty state and a recoverable case API error", async () => {
    const api = { getInvestigationCases: vi.fn().mockResolvedValue({ cases: [] }) };
    const { rerender } = render(<InvestigationCases api={api} ownerName="Analyst A" />);
    expect(await screen.findByText("No investigation cases yet")).toBeTruthy();

    api.getInvestigationCases.mockRejectedValueOnce(new Error("Case service unavailable."));
    rerender(<InvestigationCases api={api} ownerName="Analyst A" refreshKey={1} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Case service unavailable.");
  });

  it("never renders audit entries when the owner-only audit request is denied", async () => {
    const api = {
      getInvestigationCases: vi.fn().mockResolvedValue({ cases: [record] }),
      getInvestigationCaseAudit: vi.fn().mockRejectedValue(new Error("Case not found.")),
    };
    render(<InvestigationCases api={api} ownerName="Analyst A" />);
    fireEvent.click(await screen.findByRole("button", { name: /view private audit history/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("Case not found.");
    expect(screen.queryByText("FOREIGN_CASE_NOTE")).toBeNull();
  });

  it("saves resolution notes through the case API and refreshes the list", async () => {
    const api = {
      getInvestigationCases: vi.fn().mockResolvedValue({ cases: [record] }),
      updateInvestigationCase: vi.fn().mockResolvedValue({ case: { ...record, status: "IN_PROGRESS" } }),
    };
    render(<InvestigationCases api={api} ownerName="Analyst A" />);
    const notes = await screen.findByLabelText("Investigation notes");
    fireEvent.change(notes, { target: { value: "Evidence reviewed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() => expect(api.updateInvestigationCase).toHaveBeenCalledWith("case-a", "OPEN", "Evidence reviewed"));
    expect((await screen.findByRole("status")).textContent).toContain("Case updated to OPEN.");
    expect(api.getInvestigationCases).toHaveBeenCalledTimes(2);
  });
});

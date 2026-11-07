import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaymentsWorkspace from "./PaymentsWorkspace";
import { api } from "../services/api";

vi.mock("../services/api", () => ({
  api: {
    getPayments: vi.fn(),
    getPaymentReviewQueue: vi.fn(),
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
  },
}));

const sellers = [{ sellerId: "seller-shared", displayName: "Shared seller" }];
const allowPayment = {
  paymentId: "payment-allow-1",
  sellerId: "seller-shared",
  amount: "25.00",
  currency: "USD",
  status: "APPROVED",
  riskDecision: "ALLOW",
  riskScore: 0,
  riskFindings: [],
};

describe("PaymentsWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    api.getPayments.mockResolvedValue({ payments: [] });
    api.getPaymentReviewQueue.mockResolvedValue({ payments: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a payment from a shared seller and presents the PayPal Sandbox approval link", async () => {
    api.createPayment.mockResolvedValue({
      payment: { ...allowPayment, approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" },
    });
    render(<PaymentsWorkspace sellers={sellers} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /create sandbox payment/i }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Seller"), { target: { value: "seller-shared" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /create sandbox payment/i }));

    const approvalLink = await screen.findByRole("link", { name: /continue to paypal sandbox/i });
    expect(approvalLink.getAttribute("href"))
      .toBe("https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1");
    expect(api.createPayment).toHaveBeenCalledWith(
      { sellerId: "seller-shared", amount: "25.00", currency: "USD" },
      expect.any(String)
    );
  });

  it("requires a seller and enforces the supported amount range before submission", async () => {
    render(<PaymentsWorkspace sellers={sellers} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /create sandbox payment/i }).disabled).toBe(false));
    const form = screen.getByRole("button", { name: /create sandbox payment/i }).closest("form");
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(screen.getByLabelText("Seller"), { target: { value: "seller-shared" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10000.01" } });
    expect(form.checkValidity()).toBe(false);
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("shows REVIEW as non-capturable and never offers PayPal approval", async () => {
    const reviewPayment = {
        ...allowPayment,
        paymentId: "payment-review-1",
        status: "REVIEW_REQUIRED",
        riskDecision: "REVIEW",
        riskScore: 35,
        riskFindings: [{ rule: "SHARED_BENEFICIARY", points: 35, description: "Connected to flagged seller" }],
    };
    api.createPayment.mockResolvedValue({ payment: reviewPayment });
    api.getPayments.mockResolvedValueOnce({ payments: [] }).mockResolvedValueOnce({ payments: [reviewPayment] });
    render(<PaymentsWorkspace sellers={sellers} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /create sandbox payment/i }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Seller"), { target: { value: "seller-shared" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /create sandbox payment/i }));

    expect(await screen.findByText("Capture is paused. An analyst should review the recorded findings.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /continue to paypal sandbox/i })).toBeNull();
    expect(screen.getByText("REVIEW")).toBeTruthy();
    expect(api.capturePayment).not.toHaveBeenCalled();
  });

  it("shows BLOCK as prevented capture rather than a completed payment", async () => {
    api.createPayment.mockResolvedValue({
      payment: { ...allowPayment, paymentId: "payment-block-1", status: "BLOCKED", riskDecision: "BLOCK", riskScore: 60 },
    });
    render(<PaymentsWorkspace sellers={sellers} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /create sandbox payment/i }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Seller"), { target: { value: "seller-shared" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: /create sandbox payment/i }));

    expect(await screen.findByText("TrustMesh policy prevented capture. This is not a completed payment.")).toBeTruthy();
    expect(screen.queryByText(/PayPal confirmed capture completion/i)).toBeNull();
    expect(api.capturePayment).not.toHaveBeenCalled();
  });

  it("announces API load errors accessibly", async () => {
    api.getPayments.mockRejectedValue(new Error("Payment API unavailable"));
    render(<PaymentsWorkspace sellers={sellers} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Payment API unavailable"));
  });

  it("uses the authenticated backend capture endpoint after a PayPal return", async () => {
    window.history.replaceState({}, "", "/?paymentId=payment-allow-1&token=untrusted-paypal-token");
    api.getPayment.mockResolvedValue({ payment: allowPayment });
    api.capturePayment.mockResolvedValue({ payment: { ...allowPayment, status: "COMPLETED" } });
    render(<PaymentsWorkspace sellers={sellers} />);

    await waitFor(() => expect(api.capturePayment).toHaveBeenCalledWith("payment-allow-1"));
    expect(await screen.findByText("PayPal confirmed capture completion.")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("offers reconciliation after an uncertain capture lease expires", async () => {
    api.getPayments.mockResolvedValue({ payments: [{ ...allowPayment, status: "CAPTURE_UNCERTAIN", captureRetryAt: new Date(0).toISOString() }] });
    api.capturePayment.mockResolvedValue({ payment: { ...allowPayment, status: "COMPLETED" } });
    render(<PaymentsWorkspace sellers={sellers} />);

    fireEvent.click(await screen.findByRole("button", { name: /reconcile capture status/i }));
    await waitFor(() => expect(api.capturePayment).toHaveBeenCalledWith(allowPayment.paymentId));
    expect(await screen.findByText("PayPal confirmed the capture during reconciliation.")).toBeTruthy();
  });
});

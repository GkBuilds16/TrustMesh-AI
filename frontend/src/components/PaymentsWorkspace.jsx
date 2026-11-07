import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import "./PaymentsWorkspace.css";

const STATUS_COPY = {
  CREATED: "Payment setup can be retried with the same request key.",
  RISK_PENDING: "TrustMesh is evaluating seller risk before approval.",
  APPROVED: "Risk policy allows this payment to continue to PayPal Sandbox approval.",
  REVIEW_REQUIRED: "Capture is paused. An analyst should review the recorded findings.",
  BLOCKED: "TrustMesh policy prevented capture. This is not a completed payment.",
  CAPTURE_PENDING: "PayPal capture is being verified. Check status before retrying.",
  CAPTURE_UNCERTAIN: "PayPal has not confirmed the capture result yet. TrustMesh will reconcile with PayPal before another capture attempt.",
  COMPLETED: "PayPal confirmed capture completion.",
  REFUNDED: "PayPal confirmed a full refund for this payment.",
  REVERSED: "PayPal reported that the captured funds were reversed; the payment is not retained as completed.",
  FAILED: "The payment did not complete.",
  CANCELLED: "This payment was cancelled in TrustMesh and cannot be captured here.",
};

function Decision({ value }) {
  if (!value) return <span className="muted">Pending</span>;
  return <span className={`decision-label decision-${value.toLowerCase()}`}>{value}</span>;
}

export default function PaymentsWorkspace({ sellers = [] }) {
  const [sellerId, setSellerId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [payments, setPayments] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [approvalUrl, setApprovalUrl] = useState("");
  const [retryKey, setRetryKey] = useState("");
  const [retryingCaptureId, setRetryingCaptureId] = useState("");

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [mine, queue] = await Promise.all([
        api.getPayments(),
        api.getPaymentReviewQueue(),
      ]);
      setPayments(mine.payments || []);
      setReviewQueue(queue.payments || []);
    } catch (err) {
      setError(err.message || "Could not load payment status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      const paymentId = params.get("paymentId");
      const cancelled = params.get("cancelled") === "1";
      if (paymentId) {
        setLoading(true);
        try {
          const result = await api.getPayment(paymentId);
          let payment = result.payment;
          if (!cancelled && payment.status === "APPROVED" && payment.riskDecision === "ALLOW") {
            try {
              payment = (await api.capturePayment(paymentId)).payment;
              setNotice("PayPal returned to TrustMesh. Capture status was verified by the backend.");
            } catch {
              payment = (await api.getPayment(paymentId)).payment;
              setNotice("Approval was received. TrustMesh is still verifying the payment status.");
            }
          } else if (cancelled) {
            try {
              payment = (await api.cancelPayment(paymentId)).payment;
              setNotice("PayPal approval was cancelled. TrustMesh marked the payment as non-capturable.");
            } catch (err) {
              setNotice(err.message || "No capture was requested; refresh to verify the payment state.");
            }
          }
          if (active) {
            setPayments((current) => [payment, ...current.filter((item) => item.paymentId !== paymentId)]);
            const queue = await api.getPaymentReviewQueue();
            setReviewQueue(queue.payments || []);
          }
        } catch (err) {
          if (active) setError(err.message || "Could not verify the returned payment.");
        } finally {
          if (active) {
            window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
            setLoading(false);
          }
        }
      } else {
        await loadPayments();
      }
    }
    initialize();
    return () => { active = false; };
  }, [loadPayments]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setApprovalUrl("");
    setSubmitting(true);
    const key = retryKey || globalThis.crypto?.randomUUID?.() || `tm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRetryKey(key);
    try {
      const result = await api.createPayment({ sellerId, amount, currency }, key);
      const payment = result.payment;
      setPayments((current) => [payment, ...current.filter((item) => item.paymentId !== payment.paymentId)]);
      setRetryKey("");
      setAmount("");
      if (payment.riskDecision === "ALLOW" && payment.approvalUrl) {
        setApprovalUrl(payment.approvalUrl);
        setNotice("Risk policy allows the Sandbox checkout. Continue using the secure PayPal approval page.");
      } else if (payment.riskDecision === "REVIEW") {
        setNotice("Payment requires review. TrustMesh will not capture it automatically.");
        await loadPayments();
      } else if (payment.riskDecision === "BLOCK") {
        setNotice("TrustMesh policy prevented capture. No completed payment was created.");
      }
    } catch (err) {
      setError(err.message || "Payment setup failed. Retry using the same request key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reconcileCapture(paymentId) {
    setError("");
    setNotice("");
    setRetryingCaptureId(paymentId);
    try {
      const result = await api.capturePayment(paymentId);
      setPayments((current) => [result.payment, ...current.filter((item) => item.paymentId !== paymentId)]);
      setNotice(result.payment.status === "COMPLETED"
        ? "PayPal confirmed the capture during reconciliation."
        : "Capture status was checked with PayPal.");
    } catch (err) {
      setError(err.message || "Could not reconcile the PayPal capture yet.");
      await loadPayments();
    } finally {
      setRetryingCaptureId("");
    }
  }

  return (
    <section className="panel payments-panel" id="payments" aria-labelledby="payments-heading">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">PAYMENTS WORKSPACE <span className="sandbox-badge">SANDBOX</span></div>
          <h2 id="payments-heading">Payment risk and status</h2>
          <p className="muted">Create a PayPal Sandbox checkout and see the TrustMesh policy result.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Refresh payments" onClick={loadPayments} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      <form className="payment-form" onSubmit={submit}>
        <label className="auth-field">
          Seller
          <select value={sellerId} onChange={(event) => setSellerId(event.target.value)} disabled={submitting || Boolean(retryKey)} required>
            <option value="">Select a shared seller</option>
            {sellers.map((seller) => <option key={seller.sellerId} value={seller.sellerId}>{seller.displayName} ({seller.sellerId})</option>)}
          </select>
        </label>
        <label className="auth-field">
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0.01" max="10000" step="0.01" inputMode="decimal" disabled={submitting || Boolean(retryKey)} required />
        </label>
        <label className="auth-field">
          Currency
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={submitting || Boolean(retryKey)}>
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={submitting || loading || sellers.length === 0}>
          <CreditCard size={16} /> {submitting ? "Preparing Sandbox payment..." : retryKey ? "Retry same payment request" : "Create Sandbox payment"}
        </button>
      </form>

      <p className="advisory-notice">This is a Sandbox integration. Risk decisions control capture only inside TrustMesh’s application flow; they do not block external PayPal transactions. No card or bank details are stored by TrustMesh.</p>
      {error && <p className="payment-message payment-error" role="alert"><AlertTriangle size={16} />{error}</p>}
      {notice && <p className="payment-message" role="status">{notice}</p>}
      {approvalUrl && <a className="secondary-button paypal-approval-link" href={approvalUrl} target="_blank" rel="noreferrer">Continue to PayPal Sandbox <ExternalLink size={15} /></a>}

      <div className="payments-list" aria-live="polite">
        <h3>My payments</h3>
        {loading ? <p className="muted" role="status">Loading payment status...</p> : payments.length === 0 ? <p className="muted">No payments yet.</p> : payments.map((payment) => (
          <article className="payment-card" key={payment.paymentId}>
            <div className="payment-card-heading"><strong>{payment.sellerId}</strong><Decision value={payment.riskDecision} /></div>
            <div className="payment-card-meta"><span>{payment.amount} {payment.currency}</span><span>{payment.status.replaceAll("_", " ")}</span><span>Score {payment.riskScore ?? "pending"}/100</span></div>
            <small className="payment-reference">Payment reference: {payment.paymentId}</small>
            <p>{STATUS_COPY[payment.status] || "Payment status is being checked."}</p>
            {payment.failureMessage && <p className="muted">{payment.failureMessage}</p>}
            {payment.status === "CAPTURE_UNCERTAIN" && (
              <button type="button" className="secondary-button" onClick={() => reconcileCapture(payment.paymentId)} disabled={Boolean(retryingCaptureId)}>
                {retryingCaptureId === payment.paymentId ? "Checking PayPal status..." : "Reconcile capture status"}
              </button>
            )}
            {payment.refunds?.length > 0 && <p>PayPal verified refunds: {payment.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0).toFixed(2)} {payment.currency}</p>}
            {payment.riskFindings?.length > 0 && <ul className="finding-list">{payment.riskFindings.map((finding) => <li key={finding.rule}><span>{finding.description}</span><strong>+{finding.points}</strong></li>)}</ul>}
            {payment.riskAssessmentSnapshot?.evidenceAvailability && <details><summary>Evidence availability</summary><ul>{Object.entries(payment.riskAssessmentSnapshot.evidenceAvailability).map(([key, value]) => <li key={key}>{key.replaceAll(/([A-Z])/g, " $1")}: {value.replaceAll("_", " ").toLowerCase()}</li>)}</ul></details>}
          </article>
        ))}
      </div>

      <div className="payments-list review-queue">
        <h3>Analyst review queue</h3>
        <p className="muted">Review summaries are visible to authenticated analysts. This version does not provide a review override or manual capture action.</p>
        {loading ? null : reviewQueue.length === 0 ? <p className="muted">No payments require review.</p> : reviewQueue.map((payment) => (
          <article className="payment-card" key={`review-${payment.paymentId}`}>
            <div className="payment-card-heading"><strong>{payment.sellerId}</strong><Decision value={payment.riskDecision} /></div>
            <div className="payment-card-meta"><span>{payment.amount} {payment.currency}</span><span>{payment.status.replaceAll("_", " ")}</span><span>Score {payment.riskScore}/100</span></div>
            <small className="payment-reference">Payment reference: {payment.paymentId}</small>
            <ul className="finding-list">{payment.riskFindings.map((finding) => <li key={finding.rule}><span>{finding.description}</span><strong>+{finding.points}</strong></li>)}</ul>
          </article>
        ))}
      </div>
      <p className="payment-disclaimer"><ShieldCheck size={14} /> Payment ownership remains private. Analysts see only REVIEW summaries in the shared queue.</p>
    </section>
  );
}

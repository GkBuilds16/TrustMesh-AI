# PayPal Sandbox payments

TrustMesh supports an application-controlled PayPal **Sandbox** checkout. This is a hackathon integration and is not production payment processing. The Orders API merchant account receives the payment; `sellerId` is TrustMesh risk context and does not represent a seller payout or marketplace split.

## Lifecycle

```mermaid
sequenceDiagram
    actor Buyer
    participant UI as TrustMesh UI
    participant API as TrustMesh API
    participant DB as MongoDB
    participant PP as PayPal Sandbox
    Buyer->>UI: Select shared seller, amount and currency
    UI->>API: POST /api/payments + Idempotency-Key
    API->>DB: Validate seller; reserve buyer-scoped payment
    API->>PP: Create Orders v2 CAPTURE order
    API->>DB: Evaluate trusted seller/network data; save risk snapshot
    alt ALLOW
        API-->>UI: Approval URL and payment status
        UI->>PP: Buyer approves on PayPal
        PP-->>UI: Return with internal paymentId and provider token
        UI->>API: POST /api/payments/:id/capture
        API->>PP: GET stored order; compare amount, currency, custom/reference IDs
        API->>PP: Capture with stable PayPal-Request-Id
        API->>DB: Mark COMPLETED after verified capture response
    else REVIEW
        API-->>UI: REVIEW_REQUIRED; no approval URL or capture
    else BLOCK
        API-->>UI: BLOCKED; no approval URL or capture
    end
    PP-->>API: Signed webhook
    API->>PP: Verify signature and associated refund/order as applicable
    API->>DB: Deduplicate event and apply compatible state transition
```

`APPROVED` means the stored risk decision is ALLOW and the payment may continue to buyer approval. It is not a captured payment. Only a verified PayPal capture response or compatible verified webhook can produce `COMPLETED`. A full verified refund produces `REFUNDED`.

### Payment state transitions

Only the following transitions are supported by the service:

| Current state | Allowed next states | Meaning |
| --- | --- | --- |
| `CREATED` | `RISK_PENDING`, `CANCELLED` | Internal record reserved; order setup may begin. Retryable provider setup failures return to `CREATED`. |
| `RISK_PENDING` | `APPROVED`, `REVIEW_REQUIRED`, `BLOCKED`, `CREATED` | Server derives and stores the immutable risk snapshot and provider order. |
| `APPROVED` | `CAPTURE_PENDING`, `REVIEW_REQUIRED`, `CANCELLED` | Stored ALLOW result; buyer must approve the PayPal order before capture. If the seller becomes flagged before capture, the payment is held for a new assessment. |
| `REVIEW_REQUIRED` | `CANCELLED` | No approval URL or capture; there is no override flow. |
| `BLOCKED` | — | Terminal TrustMesh policy block. |
| `CAPTURE_PENDING` | `COMPLETED`, `CAPTURE_UNCERTAIN`, `APPROVED`, `FAILED`, `REVERSED`, `REFUNDED` | Capture claimed; verified response/webhook completes it, explicit order state can release the claim, and mismatches fail closed. |
| `CAPTURE_UNCERTAIN` | `CAPTURE_PENDING`, `APPROVED`, `COMPLETED`, `FAILED`, `REVERSED`, `REFUNDED` | Provider outcome was ambiguous. After lease expiry, reconciliation reads PayPal’s order before any retry; an order not yet approved returns to `APPROVED`. |
| `COMPLETED` | `REFUNDED`, `REVERSED` | Captured payment; verified partial refunds remain `COMPLETED`, full refunds become `REFUNDED`. |
| `FAILED`, `CANCELLED`, `REFUNDED`, `REVERSED` | — | Terminal in the TrustMesh payment state machine. |

These transitions are enforced by conditional database updates and state checks in the payment service. The schema enum also rejects unknown state values.

## Configuration

Copy `backend/.env.example` to `backend/.env` and supply credentials from a PayPal **Sandbox** REST app. Do not add live credentials. PayPal configuration is optional for starting the rest of TrustMesh, but payment calls fail with an actionable configuration error when credentials are absent.

| Variable | Purpose |
| --- | --- |
| `PAYPAL_CLIENT_ID` | Sandbox REST app client ID; backend only. |
| `PAYPAL_CLIENT_SECRET` | Sandbox REST app secret; backend only. |
| `PAYPAL_BASE_URL` | Must be exactly `https://api-m.sandbox.paypal.com`; live hosts are rejected. |
| `PAYPAL_WEBHOOK_ID` | Webhook identifier issued when registering the listener in PayPal. |
| `FRONTEND_BASE_URL` | TrustMesh frontend origin used for PayPal return and cancel URLs. |

`FRONTEND_BASE_URL` must use HTTPS outside localhost development.

The OAuth token is reused until shortly before expiry. Provider errors are reduced to fixed, sanitized messages; credentials and tokens are never logged or returned.

## API

All buyer/payment routes require a JWT and are rate limited to 60 requests per 15 minutes per authenticated subject. Current payment creation uses an authenticated TrustMesh analyst account as the buyer because the project has no separate buyer role.

| Method and route | Purpose |
| --- | --- |
| `POST /api/payments` | Create internal record, PayPal order and server-side risk snapshot. Requires `Idempotency-Key`; body uses `{ sellerId, amount: "12.50", currency: "USD" }`. |
| `GET /api/payments` | List the caller's own payment records. |
| `GET /api/payments/:paymentId` | Read the caller's own payment. |
| `POST /api/payments/:paymentId/assess-risk` | Return the write-once stored risk snapshot. |
| `POST /api/payments/:paymentId/capture` | Retrieve and verify the stored PayPal order, then capture only an ALLOW payment. The client cannot submit a PayPal order ID. |
| `POST /api/payments/:paymentId/cancel` | Mark an eligible internal payment non-capturable. |
| `GET /api/payments/review-queue` | Authenticated ANALYST summary of REVIEW_REQUIRED payments; buyer identity and private payment details are omitted. There is no review override. |
| `POST /api/webhooks/paypal` | Verify and idempotently process signed PayPal capture, reversal, and refund events; no buyer JWT. |

The Orders v2 API does not document an order-cancel operation for this checkout intent. For REVIEW/BLOCK the approval URL is withheld, and TrustMesh will not capture the order. Internal cancellation disables all future capture through this API; an already opened external approval screen may remain visible but cannot complete a TrustMesh capture.

## Risk evidence and policy

Payments reuse `evaluateTransaction` and the graph engine. Seller verification, the target seller's own `FLAGGED` status, and flagged shared-beneficiary relationships come from MongoDB. Target `FLAGGED` contributes a distinct 60-point rule; it is not mislabeled as a related flagged seller. Existing thresholds remain `ALLOW < 30`, `REVIEW >= 30`, and `BLOCK >= 60`.

The application has no buyer transaction history or buyer-specific amount baseline. Velocity and unusual-amount checks are marked `UNAVAILABLE` in the risk snapshot and are not inferred from the current request. REVIEW is not converted to ALLOW; no manual override/capture action is implemented. Risk decisions affect only this TrustMesh-controlled Sandbox checkout, not arbitrary PayPal transactions.

## Idempotency and state safety

- Internal creation is unique on `(buyerId, idempotencyKey)`. Reusing a key with a different seller, amount, or currency returns conflict.
- PayPal order and capture calls use deterministic `PayPal-Request-Id` values based on the internal payment ID.
- Capture uses an atomic state claim and an expiring lease. Concurrent requests cannot both call capture; an ambiguous result is represented as `CAPTURE_UNCERTAIN`. Expired attempts first retrieve PayPal's authoritative order and reuse the same request ID only if the order still requires capture.
- Capture requires the stored ALLOW result, PayPal order approval, and exact stored order ID, custom/reference payment ID, amount, and currency matches.
- Webhook signatures are verified through PayPal's verification API before event storage. Event IDs are unique; event insertion and compatible state transitions use a MongoDB transaction.
- Only a verified full refund changes status to REFUNDED; partial refunds are retained in the payment record while status stays COMPLETED. Monetary reconciliation uses integer minor units for supported two-decimal currencies.
- Capture rechecks the seller's current risk status immediately before sending capture. A seller newly marked `FLAGGED` moves the payment to `REVIEW_REQUIRED`; the original risk snapshot remains unchanged and the hold reason is displayed.
- Reversal events resolve to the stored order or capture, require a matching PayPal order/capture in the authoritative order response, and can reconcile a pending/uncertain capture without a prior completion event. Later completion notifications cannot regress `REVERSED` or `REFUNDED` states.

## Webhook setup

1. In PayPal Developer Dashboard, select the Sandbox REST app.
2. Add the public HTTPS listener URL `https://<your-api-host>/api/webhooks/paypal`.
3. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REVERSED`, and `PAYMENT.CAPTURE.REFUNDED`.
4. Copy the generated webhook ID into backend `PAYPAL_WEBHOOK_ID`.
5. Send a Sandbox event and inspect the payment record and sanitized server logs. The PayPal webhook simulator cannot be used for postback signature verification; validate against real Sandbox webhook deliveries.

The public webhook is not authenticated by the TrustMesh JWT. It only mutates state after PayPal signature verification. PayPal retries non-2xx webhook deliveries, so provider/network/database failures should remain non-2xx.

## Tests

From `backend`, run `node --test tests/paypalClient.test.js tests/paymentApi.test.js tests/riskEngine.test.js`, then `npm.cmd test`. Payment API tests use the isolated `.env.test` MongoDB database and mock the PayPal HTTP boundary; OAuth client tests use mocked fetch. No automated test sends a real PayPal request. From `frontend`, run `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build`.

## Known limitations

- Sandbox-only checkout; no real-money payment processing.
- Payments are received by the configured PayPal merchant. Seller payouts, split payments, escrow, and marketplace onboarding are not implemented.
- Buyer is currently an authenticated analyst because there is no buyer role.
- Review summaries are shared with analysts, but payment details remain buyer-scoped and there is no manual review override.
- Risk rules requiring buyer history are unavailable. As a result, only currently grounded evidence contributes to payment score.
- The existing default rate-limit store is in-memory and is per process. Multi-instance deployments must configure a shared express-rate-limit store before production use.
- Internal cancel cannot revoke an already issued PayPal order; it guarantees TrustMesh endpoints will not capture that payment.
- Refund webhooks update verified full/partial refund information; TrustMesh does not initiate refunds.
- The PayPal Sandbox flow was not tested with configured credentials in this automated validation.

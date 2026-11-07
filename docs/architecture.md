# TrustMesh AI Backend Architecture

## Workspace model

TrustMesh currently uses one shared investigation workspace. Every authenticated
analyst reads and contributes to the same seller, seller-relationship, and risk
assessment datasets. There are no organization IDs, tenant IDs, or analyst
ownership filters on these shared resources.

Investigation cases are personal to the analyst who creates them. Their audit
history is private to that same case owner. This split is intentional: shared
intelligence supports collaboration, while each analyst's case decisions and
notes remain individually owned.

## API access-control matrix

| API | Authentication | Scope and authorization |
| --- | --- | --- |
| `GET /api/health` | Public | Reports application/database readiness. |
| `POST /api/auth/register` | Public; rate limited | Creates an `ANALYST` account. Request fields cannot assign `ADMIN`. |
| `POST /api/auth/login` | Public; rate limited | Returns an expiring JWT for valid credentials. |
| `GET /api/sellers` | Valid JWT | Lists shared seller records. |
| `GET /api/sellers/:sellerId` | Valid JWT | Reads any seller in the shared workspace. |
| `GET /api/sellers/:sellerId/investigation` | Valid JWT | Reads shared seller profile, graph, related sellers, assessments, and action plan. |
| `POST /api/sellers` | Valid JWT | Creates a seller in the shared workspace. Duplicate seller IDs are rejected. There is currently no seller update or flagging endpoint. |
| `POST /api/risk/evaluate` | Valid JWT | Evaluates and saves an assessment in the shared dataset. |
| `GET /api/risk/assessments` | Valid JWT | Reads paginated shared assessment history. |
| `GET /api/risk/assessments/:assessmentId` | Valid JWT | Reads any saved assessment by ID. |
| `GET /api/risk/sellers/:sellerId/history` | Valid JWT | Reads shared assessment history for a seller. |
| `GET /api/investigation-cases` | Valid JWT | Lists cases whose `createdBy` matches the authenticated subject. |
| `POST /api/investigation-cases` | Valid JWT | Creates a case owned by the authenticated subject. Duplicate prevention is scoped to owner, seller, and action. |
| `PATCH /api/investigation-cases/:caseId` | Valid JWT and case owner | Updates only a case owned by the authenticated subject. Resolved cases cannot be reopened. |
| `GET /api/investigation-cases/:caseId/audit` | Valid JWT and case owner | Reads only the owner's case audit history. |

There is no standalone case-by-ID `GET` route. A case is returned through the
owner-filtered list and update operations.

## Authentication boundaries

Registration and login are public and protected by IP-based rate limits. All
seller, risk, case, and case-audit routes are mounted behind JWT authentication.
The middleware verifies the token signature, issuer, audience, and expiry.
Registration assigns `ANALYST` in the service regardless of extra request
fields. `ADMIN` remains a reserved model role; no administrative authorization
system or admin-only route is implemented.

JWTs are stateless and have a one-hour default lifetime. The React client stores
the token in `sessionStorage` and attaches it to API requests other than the
public health request. Production deployments must provide the required secrets
through protected environment configuration and configure trusted network
proxies deliberately.

## Shared seller and risk data

Seller and risk assessment services query the common collections without
analyst-specific filters. Seller graph analysis and investigation reports use
the complete shared seller dataset. Risk assessments are similarly visible to
all authenticated analysts. The project currently has no tenant boundary or
per-analyst ownership for those records.

Assessment outputs are prototype, rule-based results. The API accepts validated
Boolean evidence, saves the evidence and policy result, and does not block
payments or change seller status. A risk decision is not proof of fraud.

## Personal cases and audit history

Case creation records the authenticated user as `createdBy`; case listing,
updates, and duplicate checks include that owner. Case and audit writes happen
inside MongoDB transactions. Each event records its actor, type, status changes,
and whether notes changed. Audit reads first verify case ownership and then
return events for that owner. Tests cover cross-analyst denial, actor identity,
owner updates, duplicate scope, and rollback when audit persistence fails.

## Future tenant-isolation considerations

Tenant isolation is not part of the current shared-workspace policy. If it is
needed later, treat it as a separate architecture change: define tenant
membership and identity first, then scope every seller, risk, graph, case, and
audit query and uniqueness index consistently. Add cross-tenant integration
tests before enabling tenant-aware writes. Do not infer tenant identity from
client-supplied request fields.

## PayPal Sandbox payment boundary

Payment records store the authenticated buyer, shared seller ID, exact decimal amount/currency, PayPal order/capture IDs, risk findings, and a write-once lifecycle snapshot. A unique `(buyerId, idempotencyKey)` index protects request retries; separate sparse unique indexes protect provider order and capture IDs. Payment details are buyer-scoped. Authenticated analysts can read a limited shared REVIEW queue that excludes buyer identity. Existing user roles are unchanged, so the current buyer is an authenticated analyst; there is no manual review override.

The payment service calls the existing rule-based `evaluateTransaction` and graph engine with trusted seller records. It does not supply transaction-history evidence that does not exist. The target seller's own FLAGGED status is a separate 60-point BLOCK rule; flagged related sellers remain graph evidence. Risk thresholds remain in the existing policy engine. Only ALLOW can proceed to capture.

PayPal OAuth, Orders v2 create/get/capture, and postback webhook verification use backend-only credentials and the fixed Sandbox host. Provider calls use stable `PayPal-Request-Id` values. Capture is guarded by an atomic database state claim, remote order verification, and stored amount/currency/custom ID matching. Signed webhook events are deduplicated and applied with compatible state transitions in a MongoDB transaction. Internal cancellation disables TrustMesh capture; Orders v2 does not expose a supported cancel operation for this flow, so it cannot revoke an already opened approval screen.

Detailed lifecycle diagram, route contracts, environment configuration, webhook setup, test instructions, and known limitations: [payments.md](payments.md).

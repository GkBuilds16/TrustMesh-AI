# TrustMesh AI

AI-assisted fraud investigation and pre-payment risk gateway prototype.

## Current status
This repository contains a React + Express investigation workspace with shared seller/risk intelligence, owner-scoped investigation cases, and a PayPal **Sandbox-only** checkout prototype. Risk decisions are explainable and enforced only before capture through TrustMesh; they do not block arbitrary PayPal payments. This is not production payment processing.

## Requirements
- Node.js 22+
- npm
- MongoDB Atlas cluster and database user
- Atlas Network Access configured for your current public IP
- PayPal Sandbox REST app credentials are optional unless testing the Payments workspace

## Backend setup (Windows / VS Code)
1. Open the extracted `TrustMeshAI` folder in VS Code.
2. Open a PowerShell terminal and run:

   ```powershell
   Set-Location .\backend
   npm install
   Copy-Item .env.example .env
   ```

3. Edit `backend/.env` and replace the sample `MONGODB_URI` with your own Atlas connection string. Do not share or commit `.env`.
4. Start the backend:

   ```powershell
   npm run dev
   ```

5. Open http://localhost:5000/api/health. A successful response should report `status: healthy` and `database: connected`.

## Structure
- `backend/config/`: environment and database configuration
- `backend/routes/`: endpoint declarations
- `backend/controllers/`: HTTP request/response handlers
- `backend/middleware/`: shared Express middleware
- `backend/models/`: Mongoose schemas for analysts, sellers, risk assessments, cases, and payments
- `backend/services/`: business logic and PayPal Sandbox integration
- `backend/risk-engine/`: deterministic risk scoring and policy
- `backend/graph-engine/`: seller relationship analysis
- `backend/tests/`: automated tests
- `frontend/`: React dashboard, authentication, investigation, and payments
- `docs/`: architecture notes
- `scripts/`: seed/evaluation scripts

## PayPal Sandbox payments

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`, and `FRONTEND_BASE_URL` in the backend environment. The supported API host is Sandbox only. Never place the PayPal secret in Vite environment variables or commit environment files. Setup, lifecycle, API contracts, webhook registration, tests, and current limitations are documented in [docs/payments.md](docs/payments.md).

The checkout records `sellerId` as risk context; PayPal sends funds to the configured merchant account. Seller payout splitting, buyer-history risk signals, and manual review overrides are not implemented.

Backend tests run with `npm.cmd test` from `backend`. Frontend tests, lint, and build run with `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build` from `frontend`.

Render and Vercel root directories, commands, health-check path, and environment variable names are listed in [docs/deployment.md](docs/deployment.md). This configuration has not been deployed or verified against hosted infrastructure.

## Security
- Never put secrets in frontend code.
- Keep `.env` out of Git.
- Use synthetic test data during development.
- A risk score is not proof of fraud; include review paths and measure false positives.
- The backend—not the browser or an LLM response—must enforce payment decisions.

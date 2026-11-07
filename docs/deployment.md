# Render and Vercel deployment settings

This document describes configuration only. The application has not been deployed.

## Render backend

- **Root Directory:** `backend`
- **Runtime:** Node
- **Build Command:** `npm ci`
- **Start Command:** `npm start`
- **Health Check Path:** `/api/health`
- Render supplies `PORT`; the server binds to `0.0.0.0`.

Set these Render environment variables:

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | Required; set to `production`. |
| `NODE_VERSION` | Recommended; pin Render to `22.20.0`, matching the project environment and avoiding a hosting default version change. |
| `MONGODB_URI` | Required; use the production-like Atlas database, never `trustmesh_test`. |
| `JWT_SECRET` | Required; generate a random secret of at least 32 UTF-8 bytes. |
| `FRONTEND_BASE_URL` | Required HTTPS origin of the deployed Vercel frontend; used for CORS and PayPal return/cancel URLs. |
| `PORT` | Supplied by Render; do not hardcode it in the service settings. |
| `JWT_EXPIRES_IN` | Optional; defaults to `1h`. |
| `PAYPAL_CLIENT_ID` | Required only to use the PayPal Sandbox payment features. Use a Sandbox app. |
| `PAYPAL_CLIENT_SECRET` | Required only to use PayPal Sandbox payment features; backend secret. |
| `PAYPAL_BASE_URL` | Required for payment operations; must be `https://api-m.sandbox.paypal.com`. |
| `PAYPAL_WEBHOOK_ID` | Required for verified webhook processing; backend-only webhook identifier. |

The server refuses production startup with a missing/short JWT secret, a missing frontend origin, an invalid frontend HTTPS origin, or a MongoDB URI targeting `trustmesh_test`. Keep PayPal credentials in Render's backend environment settings; never add them to Vercel.

Configure MongoDB Atlas Network Access for the Render service's outbound connectivity and use a least-privilege database user. Do not use a broad public IP allowlist. Render outbound addresses can vary by plan/configuration, so use its current networking guidance when setting Atlas access.

Register the HTTPS webhook URL `https://<render-service-host>/api/webhooks/paypal` in the PayPal Sandbox Developer Dashboard and subscribe to the event names documented in [payments.md](./payments.md). Configure the generated webhook ID in Render.

## Vercel frontend

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Install Command:** `npm ci`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Node.js Version:** Select `22.x` in Vercel project settings.

Set this Vercel environment variable for each deployment environment:

| Variable | Requirement |
| --- | --- |
| `VITE_API_BASE_URL` | Required; full backend API base URL ending in `/api`, such as `https://<render-service-host>/api`. |

Vite embeds `VITE_` variables into frontend build output. Only the public backend API URL belongs there. The API code currently falls back to localhost if this variable is absent, so set it in Vercel for production and preview builds. The backend CORS policy allows the exact origin in `FRONTEND_BASE_URL`; set matching origins for each frontend environment as needed.

## Before allowing traffic

1. Set the production-like environment variables in the hosting dashboards without copying real secrets into source files.
2. Confirm Render starts successfully and `GET /api/health` returns HTTP 200 with the database connected.
3. Load the Vercel frontend and confirm browser requests reach the Render API without CORS errors.
4. Verify unauthenticated protected API requests remain rejected.
5. If Sandbox payments are enabled, complete the documented manual Sandbox checkout and confirm signed webhook delivery. This is not a production payment integration.

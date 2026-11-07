const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const REQUEST_TIMEOUT_MS = 15_000;

export function readPayPalConfig(env = process.env) {
  const baseUrl = env.PAYPAL_BASE_URL || SANDBOX_BASE_URL;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw configurationError("PayPal configuration error: PAYPAL_BASE_URL must be the Sandbox HTTPS endpoint.");
  }

  if (parsed.origin !== SANDBOX_BASE_URL || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw configurationError("PayPal configuration error: only https://api-m.sandbox.paypal.com is supported.");
  }

  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw configurationError("PayPal Sandbox is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the backend.");
  }

  return {
    baseUrl: SANDBOX_BASE_URL,
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    webhookId: env.PAYPAL_WEBHOOK_ID || "",
  };
}

export function createPayPalClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let token = null;
  let tokenExpiresAt = 0;
  let tokenRequest = null;

  async function getAccessToken() {
    const config = readPayPalConfig(env);
    if (token && now() < tokenExpiresAt - 60_000) return token;
    if (tokenRequest) return tokenRequest;

    tokenRequest = (async () => {
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "grant_type=client_credentials",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new Error("PayPal Sandbox OAuth request failed. Check backend network access and retry.");
      }
      const data = await readJson(response);
      if (!response.ok || typeof data.access_token !== "string" || !Number.isFinite(data.expires_in)) {
        throw new Error("PayPal Sandbox OAuth request was rejected. Check the configured Sandbox credentials.");
      }
      token = data.access_token;
      tokenExpiresAt = now() + data.expires_in * 1000;
      return token;
    })();

    try {
      return await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  }

  async function apiRequest(path, { method = "GET", body, requestId } = {}) {
    const config = readPayPalConfig(env);
    const accessToken = await getAccessToken();
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("PayPal Sandbox request failed. Check network connectivity and retry safely.");
    }
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error("PayPal Sandbox could not complete the requested operation.");
      error.code = "PAYPAL_API_REJECTED";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  return {
    getAccessToken,
    createOrder: (payload, requestId) => apiRequest("/v2/checkout/orders", { method: "POST", body: payload, requestId }),
    getOrder: (orderId) => apiRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`),
    captureOrder: (orderId, requestId) => apiRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", body: {}, requestId }),
    getRefund: (refundId) => apiRequest(`/v2/payments/refunds/${encodeURIComponent(refundId)}`),
    verifyWebhook: async (headers, webhookEvent) => {
      const config = readPayPalConfig(env);
      if (!config.webhookId) throw configurationError("PayPal webhook verification is not configured. Set PAYPAL_WEBHOOK_ID.");
      const data = await apiRequest("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: {
          auth_algo: headers.authAlgo,
          cert_url: headers.certUrl,
          transmission_id: headers.transmissionId,
          transmission_sig: headers.transmissionSig,
          transmission_time: headers.transmissionTime,
          webhook_id: config.webhookId,
          webhook_event: webhookEvent,
        },
      });
      return data.verification_status === "SUCCESS";
    },
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function configurationError(message) {
  const error = new Error(message);
  error.code = "PAYPAL_NOT_CONFIGURED";
  error.status = 503;
  error.expose = true;
  return error;
}

export const paypalClient = createPayPalClient();

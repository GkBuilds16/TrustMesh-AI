import test from "node:test";
import assert from "node:assert/strict";
import { createPayPalClient, readPayPalConfig } from "../services/paypalClient.js";

test("PayPal configuration is optional until an operation is requested and requires Sandbox credentials", () => {
  assert.throws(
    () => readPayPalConfig({ PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com" }),
    /Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET/
  );
  assert.throws(
    () => readPayPalConfig({ PAYPAL_BASE_URL: "https://api-m.paypal.com", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }),
    /only https:\/\/api-m\.sandbox\.paypal\.com is supported/
  );
});

test("a missing PayPal configuration fails before attempting any network request", async () => {
  let calls = 0;
  const client = createPayPalClient({ env: {}, fetchImpl: async () => { calls++; } });
  await assert.rejects(client.getAccessToken(), /Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET/);
  assert.equal(calls, 0);
});

test("OAuth token acquisition is reused for multiple PayPal REST requests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/v1/oauth2/token")) {
      return jsonResponse({ access_token: "sandbox-token", expires_in: 3600 });
    }
    return jsonResponse({ id: "ORDER-1", links: [] });
  };
  const client = createPayPalClient({
    env: {
      PAYPAL_CLIENT_ID: "sandbox-client-id",
      PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
      PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    },
    fetchImpl,
  });

  await client.getAccessToken();
  await client.getOrder("ORDER-1");
  assert.equal(calls.filter((call) => call.url.endsWith("/v1/oauth2/token")).length, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer sandbox-token");
});

test("order requests send PayPal idempotency and contain no card details", async () => {
  let request;
  const client = createPayPalClient({
    env: { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      request = { url, options };
      return jsonResponse({ id: "ORDER-2", links: [] });
    },
  });
  await client.createOrder({ intent: "CAPTURE", purchase_units: [] }, "tm-order-payment");
  assert.equal(request.options.headers["PayPal-Request-Id"], "tm-order-payment");
  assert.equal(request.options.headers.Authorization, "Bearer token");
  assert.doesNotMatch(request.options.body, /card_number|cvv|client_secret/i);
});

test("failed OAuth errors do not expose credentials or provider response text", async () => {
  const client = createPayPalClient({
    env: { PAYPAL_CLIENT_ID: "private-id", PAYPAL_CLIENT_SECRET: "private-secret" },
    fetchImpl: async () => jsonResponse({ error_description: "private-secret rejected" }, 401),
  });
  await assert.rejects(client.getAccessToken(), (error) => {
    assert.match(error.message, /configured Sandbox credentials/);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test("OAuth credentials are reacquired when the cached token reaches its safety window", async () => {
  let now = 1_000_000;
  let tokenCalls = 0;
  const client = createPayPalClient({
    env: { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" },
    now: () => now,
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/oauth2/token")) {
        tokenCalls++;
        return jsonResponse({ access_token: `token-${tokenCalls}`, expires_in: 120 });
      }
      return jsonResponse({ id: "ORDER-EXPIRY" });
    },
  });
  assert.equal(await client.getAccessToken(), "token-1");
  now += 61_000;
  assert.equal(await client.getAccessToken(), "token-2");
  assert.equal(tokenCalls, 2);
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

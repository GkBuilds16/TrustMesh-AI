import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.js";

const EVENT = {
  id: "WH-TEST_EVENT-001",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { payer: { email_address: "private@example.test" } },
};

async function postWebhook(service) {
  const records = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [
    level,
    (message, fields) => records.push({ level, message, fields }),
  ]));
  const server = createApp({ payments: service, logger }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/paypal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PayPal-Transmission-Sig": "signature-must-not-be-logged",
      },
      body: JSON.stringify(EVENT),
    });
    return { response, data: await response.json(), records };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("logs verified webhook metadata and successful response without sensitive data", async () => {
  const result = await postWebhook({
    async processWebhook({ onVerificationResult }) {
      onVerificationResult(true);
      return { received: true, duplicate: false };
    },
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.data.success, true);
  const requestLog = result.records.find(({ fields }) => fields.event === "request_received");
  assert.equal(requestLog.fields.eventType, EVENT.event_type);
  assert.equal(requestLog.fields.eventId, EVENT.id);
  assert.equal(result.records.find(({ fields }) => fields.event === "verification_result").fields.verificationResult, "SUCCESS");
  assert.equal(result.records.find(({ fields }) => fields.event === "response_finished").fields.status, 200);

  const serializedLogs = JSON.stringify(result.records);
  assert.equal(serializedLogs.includes("signature-must-not-be-logged"), false);
  assert.equal(serializedLogs.includes("private@example.test"), false);
  assert.equal(serializedLogs.includes("resource"), false);
});

test("logs failed verification safely and preserves the unauthorized response", async () => {
  const result = await postWebhook({
    async processWebhook({ onVerificationResult }) {
      onVerificationResult(false);
      throw Object.assign(new Error("untrusted provider detail"), {
        code: "INVALID_WEBHOOK_SIGNATURE",
        status: 401,
      });
    },
  });

  assert.equal(result.response.status, 401);
  const failure = result.records.find(({ fields }) => fields.event === "processing_failed");
  assert.equal(failure.fields.verificationResult, "FAILURE");
  assert.equal(failure.fields.errorCode, "INVALID_WEBHOOK_SIGNATURE");
  assert.equal(failure.fields.errorMessage, "PayPal webhook signature verification failed.");
  assert.equal(failure.fields.status, 401);
  assert.equal(result.records.find(({ fields }) => fields.event === "response_finished").fields.status, 401);
  assert.equal(JSON.stringify(result.records).includes("untrusted provider detail"), false);
  assert.equal(JSON.stringify(result.records).includes("signature-must-not-be-logged"), false);
});

test("logs duplicate verified events and keeps the successful duplicate response", async () => {
  const result = await postWebhook({
    async processWebhook({ onVerificationResult }) {
      onVerificationResult(true);
      return { received: true, duplicate: true };
    },
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.data.duplicate, true);
  const responseLog = result.records.find(({ fields }) => fields.event === "response_finished");
  assert.equal(responseLog.fields.verificationResult, "SUCCESS");
  assert.equal(responseLog.fields.duplicate, true);
  assert.equal(responseLog.fields.status, 200);
});

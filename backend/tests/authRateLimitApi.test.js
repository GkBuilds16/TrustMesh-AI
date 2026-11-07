import test from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";

const server = app.listen(0, "127.0.0.1");
const baseUrl = await new Promise((resolve, reject) => {
  server.once("listening", () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
  server.once("error", reject);
});

async function post(path, forwardedFor) {
  const headers = { "Content-Type": "application/json" };
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: "{}",
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test("limits repeated login attempts with a clear retry response", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await post("/api/auth/login");
    assert.equal(response.status, 400);
  }

  const limited = await post("/api/auth/login");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.match(limited.body.message, /Too many login attempts/);
});

test("limits repeated registration attempts with a clear retry response", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await post("/api/auth/register");
    assert.equal(response.status, 400);
  }

  const limited = await post("/api/auth/register");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.match(limited.body.message, /Too many registration attempts/);
});

test("login rate limiting keys on the address added by the trusted proxy hop", async () => {
  const trustedClientAddress = "198.51.100.41";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const untrustedPrefix = `203.0.113.${attempt + 1}`;
    const response = await post(
      "/api/auth/login",
      `${untrustedPrefix}, ${trustedClientAddress}`
    );
    assert.equal(response.status, 400);
  }

  const sameProxyClient = await post(
    "/api/auth/login",
    `192.0.2.99, ${trustedClientAddress}`
  );
  assert.equal(sameProxyClient.status, 429);

  const differentProxyClient = await post(
    "/api/auth/login",
    "203.0.113.77, 198.51.100.42"
  );
  assert.equal(differentProxyClient.status, 400);
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

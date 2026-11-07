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

async function post(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

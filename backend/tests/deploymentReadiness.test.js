import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.js";

const originalFrontendOrigin = process.env.FRONTEND_BASE_URL;
let server;
let baseUrl;

test.before(async () => {
  process.env.FRONTEND_BASE_URL = "https://trustmesh-frontend.example";
  server = createApp().listen(0, "127.0.0.1");
  baseUrl = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
});

test("CORS allows the configured frontend origin and omits headers for other browser origins", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://trustmesh-frontend.example" },
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://trustmesh-frontend.example");

  const denied = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test.after(async () => {
  try {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    if (originalFrontendOrigin === undefined) delete process.env.FRONTEND_BASE_URL;
    else process.env.FRONTEND_BASE_URL = originalFrontendOrigin;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import app from "../app.js";

const server = app.listen(0, "127.0.0.1");
const baseUrl = await new Promise((resolve, reject) => {
  server.once("listening", () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
  server.once("error", reject);
});

test("rejects compressed JSON before parsing the compressed payload", async () => {
  const malformedCompressedBody = Buffer.concat([
    gzipSync(Buffer.from("{}")),
    Buffer.from("trailing bytes"),
  ]);

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    },
    body: malformedCompressedBody,
  });

  assert.equal(response.status, 415);
});

test("continues accepting uncompressed JSON requests", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 400);
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

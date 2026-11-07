import test from "node:test";
import assert from "node:assert/strict";
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  isWithinBcryptPasswordLimit,
  loginUser,
  registerUser,
} from "../services/authService.js";

test("accepts passwords exactly at bcrypt's 72-byte boundary", () => {
  assert.equal(BCRYPT_MAX_PASSWORD_BYTES, 72);
  assert.equal(isWithinBcryptPasswordLimit("a".repeat(72)), true);
  assert.equal(isWithinBcryptPasswordLimit("a".repeat(73)), false);
  assert.equal(isWithinBcryptPasswordLimit("😀".repeat(18)), true);
  assert.equal(isWithinBcryptPasswordLimit("😀".repeat(19)), false);
});

test("registration rejects multibyte passwords exceeding 72 UTF-8 bytes", async () => {
  await assert.rejects(
    registerUser({
      name: "Boundary Analyst",
      email: "bcrypt-boundary@example.com",
      password: "😀".repeat(19),
    }),
    /72 UTF-8 bytes/
  );
});

test("login rejects passwords exceeding 72 UTF-8 bytes before lookup", async () => {
  await assert.rejects(
    loginUser({
      email: "bcrypt-boundary@example.com",
      password: "😀".repeat(19),
    }),
    (error) =>
      error.code === "INVALID_CREDENTIALS" &&
      error.message === "Invalid email or password."
  );
});

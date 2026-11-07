
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function isWithinBcryptPasswordLimit(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES
  );
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret === "REPLACE_WITH_A_LONG_RANDOM_SECRET") {
    throw new Error("JWT_SECRET is not configured securely.");
  }

  return secret;
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
      issuer: "trustmesh-ai",
      audience: "trustmesh-ai-app",
    }
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function registerUser({ name, email, password }) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw new Error("Name must contain at least 2 characters.");
  }

  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw new Error("A valid email address is required.");
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    !isWithinBcryptPasswordLimit(password)
  ) {
    throw new Error(
      "Password must contain at least 12 characters and at most 72 UTF-8 bytes."
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    const error = new Error("An account with this email already exists.");
    error.code = "EMAIL_EXISTS";
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: "ANALYST",
  });

  return {
    user: publicUser(user),
    token: createToken(user),
  };
}

export async function loginUser({ email, password }) {
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    throw new Error("Email and password are required.");
  }

  if (!isWithinBcryptPasswordLimit(password)) {
    const error = new Error("Invalid email or password.");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  const user = await User.findOne({
    email: email.trim().toLowerCase(),
  }).select("+passwordHash");

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    const error = new Error("Invalid email or password.");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  return {
    user: publicUser(user),
    token: createToken(user),
  };
}

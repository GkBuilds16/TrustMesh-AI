
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { disconnectTestDatabase } from "./testDatabaseLifecycle.js";

import Seller from "../models/Seller.js";
import {
  createSeller,
  getSellerById,
  getSellersByIds,
  getAllSellers,
} from "../services/sellerService.js";

test("seller service integration", async (t) => {
  // Refuse to run destructive cleanup against any other database.
  assert.equal(mongoose.connection.name, "trustmesh_test");

  // Remove only test records created by this test suite.
  const testSellerIds = [
    "test-seller-A",
    "test-seller-B",
  ];

  await Seller.deleteMany({
    sellerId: { $in: testSellerIds },
  });

  t.after(async () => {
    try {
      await Seller.deleteMany({
        sellerId: { $in: testSellerIds },
      });
    } finally {
      await disconnectTestDatabase();
    }
  });

  await t.test("creates and retrieves a seller", async () => {
    const created = await createSeller({
      sellerId: "test-seller-A",
      displayName: "Test Seller A",
      beneficiaryIds: ["test-beneficiary-1"],
      verificationStatus: "PENDING",
    });

    assert.equal(created.sellerId, "test-seller-A");
    assert.equal(created.verificationStatus, "PENDING");

    const found = await getSellerById("test-seller-A");

    assert.equal(found.displayName, "Test Seller A");
    assert.deepEqual(found.beneficiaryIds, [
      "test-beneficiary-1",
    ]);
  });

  await t.test("retrieves sellers by IDs", async () => {
    await createSeller({
      sellerId: "test-seller-B",
      displayName: "Test Seller B",
      beneficiaryIds: ["test-beneficiary-2"],
    });

    const found = await getSellersByIds([
      "test-seller-A",
      "test-seller-B",
    ]);

    assert.equal(found.length, 2);
  });

  await t.test("retrieves all sellers", async () => {
    const found = await getAllSellers();

    assert.ok(
      found.some((seller) => seller.sellerId === "test-seller-A")
    );
    assert.ok(
      found.some((seller) => seller.sellerId === "test-seller-B")
    );
  });

  await t.test("rejects missing seller IDs", async () => {
    await assert.rejects(
      createSeller({
        displayName: "Invalid Seller",
      }),
      /sellerId is required/
    );
  });
});

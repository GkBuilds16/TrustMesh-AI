
import Seller from "../models/Seller.js";

export async function createSeller(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Seller data must be an object.");
  }

  const {
    sellerId,
    displayName,
    beneficiaryIds = [],
    verificationStatus = "UNVERIFIED",
  } = data;

  if (typeof sellerId !== "string" || !sellerId.trim()) {
    throw new Error("sellerId is required.");
  }

  if (typeof displayName !== "string" || !displayName.trim()) {
    throw new Error("displayName is required.");
  }

  if (
    !Array.isArray(beneficiaryIds) ||
    !beneficiaryIds.every(
      (id) => typeof id === "string" && id.trim().length > 0
    )
  ) {
    throw new Error(
      "beneficiaryIds must be an array of non-empty strings."
    );
  }

  if (
    !["UNVERIFIED", "PENDING", "VERIFIED"].includes(
      verificationStatus
    )
  ) {
    throw new Error("Invalid verificationStatus.");
  }

  return Seller.create({
    sellerId: sellerId.trim(),
    displayName: displayName.trim(),
    beneficiaryIds: beneficiaryIds.map((id) => id.trim()),
    verificationStatus,
  });
}

export async function getSellerById(sellerId) {
  if (typeof sellerId !== "string" || !sellerId.trim()) {
    throw new Error("A non-empty sellerId is required.");
  }

  return Seller.findOne({ sellerId: sellerId.trim() }).lean();
}

export async function getSellersByIds(sellerIds) {
  if (
    !Array.isArray(sellerIds) ||
    !sellerIds.every(
      (id) => typeof id === "string" && id.trim().length > 0
    )
  ) {
    throw new Error("sellerIds must be an array of non-empty strings.");
  }

  return Seller.find({
    sellerId: { $in: sellerIds.map((id) => id.trim()) },
  }).lean();
}

export async function getAllSellers() {
  return Seller.find({}).lean();
}

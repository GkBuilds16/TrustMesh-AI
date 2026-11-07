
import mongoose from "mongoose";

const sellerSchema = new mongoose.Schema(
  {
    sellerId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    beneficiaryIds: {
      type: [String],
      default: [],
      validate: {
        validator: (ids) =>
          ids.every((id) => typeof id === "string" && id.trim().length > 0),
        message: "Beneficiary IDs must be non-empty strings.",
      },
    },

    verificationStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED"],
      default: "UNVERIFIED",
    },

    riskStatus: {
      type: String,
      enum: ["UNASSESSED", "UNDER_REVIEW", "FLAGGED", "CLEARED"],
      default: "UNASSESSED",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Seller =
  mongoose.models.Seller || mongoose.model("Seller", sellerSchema);

export default Seller;

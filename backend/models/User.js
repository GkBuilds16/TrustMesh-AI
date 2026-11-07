
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: 254,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["ANALYST", "ADMIN"],
      default: "ANALYST",
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const User =
  mongoose.models.User || mongoose.model("User", userSchema);

export default User;

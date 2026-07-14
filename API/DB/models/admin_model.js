import mongoose from "mongoose";
const { Schema } = mongoose;

const adminSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    image_url: {
      type: String,
      required: false,
      trim: true,
      maxlength: 2048,
    },
    activityStatus: {
      type: String,
      default: "offline",
      enum: ["online", "offline"],
      required: false,
    },
    lastLogin: {
      type: Date,
      required: false,
    },
    role: {
      type: String,
      default: "admin",
      enum: ["admin"],
      required: false,
    },
    bootstrapKey: {
      type: String,
      enum: ["initial-admin"],
      required: false,
      immutable: true,
      select: false,
    },
    token: {
      type: String,
      required: false,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

adminSchema.index({ createdAt: -1, _id: -1 });
adminSchema.index(
  { bootstrapKey: 1 },
  { unique: true, sparse: true, name: "unique_initial_admin_bootstrap" },
);

export default mongoose.model("admin", adminSchema);

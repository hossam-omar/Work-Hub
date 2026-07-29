import mongoose from "mongoose";
const { Schema } = mongoose;

const clientSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    image_url: {
      type: String,
    },
    coverImage_url: {
      type: String,
    },
    country: {
      type: String,
      required: true,
    },
    lastLogin: {
      type: Date,
      required: false,
    },
    activityStatus: {
      type: String,
      default: "offline",
      required: false,
    },
    role: {
      type: String,
      default: "client",
    },
    token: {
      type: String,
      required: false,
    },
    ordersCount: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

clientSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model("client", clientSchema);

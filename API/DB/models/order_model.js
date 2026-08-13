import mongoose from "mongoose";
const { Schema } = mongoose;

const orderSchema = new Schema(
  {
    requestId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "request",
    },
    freelancerId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "freelancer",
    },
    clientId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "client",
    },
    serviceId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "service",
    },
    orderStatus: {
      type: String,
      default: "Ongoing",
    },
  },
  {
    timestamps: true,
  },
);

orderSchema.index({ clientId: 1 });

export default mongoose.model("order", orderSchema);

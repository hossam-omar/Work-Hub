import mongoose from "mongoose";
const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
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
    rating: {
      type: Number,
      required: true,
      enum: [1, 2, 3, 4, 5],
    },
    reviewDesc: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

reviewSchema.index({ clientId: 1 });

export default mongoose.model("review", reviewSchema);

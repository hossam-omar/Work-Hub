import mongoose from "mongoose";
const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    freelancer: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "freelancer",
    },
    client: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "client",
    },
    readByFreelancer: {
      type: Boolean,
    },
    readByClient: {
      type: Boolean,
    },
    lastMessage: {
      type: mongoose.Types.ObjectId,
      ref: "message",
    },
  },
  {
    timestamps: true,
  },
);

conversationSchema.index({ client: 1 });

export default mongoose.model("conversation", conversationSchema);

import mongoose from "mongoose";
const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversation: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "conversation",
    },
    senderId: {
      type: mongoose.Types.ObjectId,
      required: true,
    },
    senderType: {
      type: String,
      required: true,
    },
    messageContent: {
      type: String,
      required: true,
    },
    messageStatus: {
      type: String,
      default: "sent",
    },
    creationDate: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ senderId: 1, senderType: 1 });

export default mongoose.model("message", messageSchema);

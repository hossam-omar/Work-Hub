import mongoose from "mongoose";
const { Schema } = mongoose;

const postUserRoles = ["client", "freelancer"];

const commentSchema = new Schema(
  {
    _id: {
      type: Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    userRole: {
      type: String,
      enum: postUserRoles,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
    id: false,
  },
);

const postSchema = new Schema(
  {
    communityId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "community",
    },
    posterId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    posterType: {
      type: String,
      required: true,
      enum: postUserRoles,
    },
    caption: {
      type: String,
      required: true,
      trim: true,
    },
    media_url: {
      type: String,
      trim: true,
    },
    likes: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
    comments: {
      type: [commentSchema],
      default: [],
    },
    // Legacy field kept for existing clients/data; prefer timestamps.createdAt for new reads.
    creationDate: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

postSchema.index({ posterType: 1, posterId: 1 });
postSchema.index({ communityId: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ "comments.userId": 1, "comments.userRole": 1 });
postSchema.index({ likes: 1 });

export default mongoose.model("post", postSchema);

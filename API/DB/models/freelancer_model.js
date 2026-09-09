import mongoose from "mongoose";
const { Schema } = mongoose;

const freelancerSchema = new Schema(
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
    phoneNumber: {
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
    desc: {
      type: String,
    },
    activityStatus: {
      type: String,
      default: "offline",
    },
    lastLogin: {
      type: Date,
    },
    languages: {
      type: [String],
    },
    skills: {
      type: [String],
    },
    servicesCount: {
      type: Number,
      default: 0,
    },
    specialization: {
      type: String,
    },
    role: {
      type: String,
      default: "freelancer",
    },
    token: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("freelancer", freelancerSchema);

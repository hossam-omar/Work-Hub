import mongoose from "mongoose";
const { Schema } = mongoose;

const courseSchema = new Schema(
  {
    categoryId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "category",
    },
    proffName: {
      type: String,
      required: true,
    },
    proffImage_url: {
      type: String,
    },
    ProffDesc: {
      type: String,
    },
    courseTitle: {
      type: String,
      required: true,
    },
    courseDesc: {
      type: String,
      required: true,
    },
    courseCoverImage_url: {
      type: String,
    },
    courseDuration: {
      type: String,
      required: true,
    },
    courseLink: {
      type: String,
      required: true,
    },
    aboutCourse: {
      type: String,
      required: true,
    },
    enrolledFreelancersIds: {
      type: [mongoose.Types.ObjectId],
      required: false,
      ref: "freelancer",
    },
    enrolledClientsIds: {
      type: [mongoose.Types.ObjectId],
      required: false,
      ref: "client",
    },
  },
  {
    timestamps: true,
  },
);

courseSchema.index({ enrolledClientsIds: 1 });

export default mongoose.model("course", courseSchema);

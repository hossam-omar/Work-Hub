import express from "express";
import valMiddleware from "../../middleware/val.middleware.js";
import { updatePasswordSchema } from "../validation/validation.js";
import {
  getAllFreelancers,
  deleteFreelancer,
  updateFreelancerInfo,
  updateFreelancerPassword,
  getFreelancerById,
} from "./freelancerController.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import endPoints from "../../middleware/endPoints.js";
import { updateInfoSchema } from "./freelancersSchema.js";
import { upload } from "../../middleware/uploadImages.js";

const router = express.Router();

router.get(
  "/getAllFreelancers",
  auth(endPoints.freelancer),
  valMiddleware(),
  asyncHandler(getAllFreelancers),
);
router.get("/getFreelancerById/:id", getFreelancerById);
router.put(
  "/updateFreelancerInfo/:id",
  validateParams(),
  valMiddleware(updateInfoSchema),
  upload.single("image"),
  updateFreelancerInfo,
);
// router.put('/uploadImage/:id', upload.single('image'), uploadImage);
router.put(
  "/updateFreelancerPassword/:id",
  validateParams(),
  valMiddleware(updatePasswordSchema),
  updateFreelancerPassword,
);
router.delete(
  "/deleteFreelancer/:id",
  validateParams(),
  asyncHandler(deleteFreelancer),
);

export default router;

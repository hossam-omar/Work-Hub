import express from "express";
import auth from "../../middleware/auth.middleware.js";
import valMiddleware,{validateObjectIdParams} from "../../middleware/val.middleware.js";
import endPoints from "../../middleware/endPoints.js";
import {
  getAllFreelancers,
  deleteFreelancer,
  updateFreelancerInfo,
  updateFreelancerPassword,
  getFreelancerById,
} from "./freelancerController.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  updateInfoSchema,
  updatePasswordSchema,
  getFreelancersQuerySchema,
} from "./freelancersSchema.js";
import { upload } from "../../middleware/uploadImages.js";

const router = express.Router();

router.get(
  "/getAllFreelancers",
  auth(endPoints.freelancer),
  valMiddleware(getFreelancersQuerySchema, { source: "query" }),
  asyncHandler(getAllFreelancers),
);
router.get(
  "/getFreelancerById/:id",
  auth(endPoints.freelancer),
  validateObjectIdParams("id"),
  asyncHandler(getFreelancerById),
);
router.put(
  "/updateFreelancerInfo/:id",
  auth(endPoints.freelancer),
  valMiddleware(updateInfoSchema),
  validateObjectIdParams("id"),
  upload.single("image"),
  updateFreelancerInfo,
);
router.put(
  "/updateFreelancerPassword/:id",
  auth(endPoints.freelancer),
  valMiddleware(updatePasswordSchema),
  validateObjectIdParams("id"),
  asyncHandler(updateFreelancerPassword),
);
router.delete(
  "/deleteFreelancer/:id",
  auth(endPoints.freelancer),
  validateObjectIdParams("id"),
  asyncHandler(deleteFreelancer),
);

export default router;

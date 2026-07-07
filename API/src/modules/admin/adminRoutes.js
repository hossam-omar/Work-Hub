import express from "express";
import valMiddleware, {
  validateObjectIdParams,
} from "../../middleware/val.middleware.js";
import {
  addAdmin,
  deleteAdmin,
  getAllAdmins,
  updateAdminInfo,
  updateAdminPassword,
  uploadAdminImage,
} from "./adminController.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  createAdminSchema,
  updateAdminPasswordSchema,
  updateInfoSchema,
} from "./adminSchema.js";
import auth from "../../middleware/auth.middleware.js";
import endPoints from "../../middleware/endPoints.js";
import { upload } from "../../middleware/uploadImages.js";

const router = express.Router();

router.get(
  "/getAllAdmins",
  auth(endPoints.admin),
  asyncHandler(getAllAdmins),
);
router.post(
  "/addAdmin",
  auth(endPoints.admin),
  valMiddleware(createAdminSchema, { assignValidatedData: true }),
  asyncHandler(addAdmin),
);
router.put(
  "/uploadAdminImage/:id",
  validateObjectIdParams("id"),
  auth(endPoints.admin),
  upload.single("image"),
  asyncHandler(uploadAdminImage),
);
router.put(
  "/updateAdminInfo/:id",
  validateObjectIdParams("id"),
  auth(endPoints.admin),
  valMiddleware(updateInfoSchema, { assignValidatedData: true }),
  asyncHandler(updateAdminInfo),
);
router.put(
  "/updateAdminPassword/:id",
  validateObjectIdParams("id"),
  auth(endPoints.admin),
  valMiddleware(updateAdminPasswordSchema, { assignValidatedData: true }),
  asyncHandler(updateAdminPassword),
);
router.delete(
  "/deleteAdmin/:id",
  validateObjectIdParams("id"),
  auth(endPoints.admin),
  asyncHandler(deleteAdmin),
);

export default router;

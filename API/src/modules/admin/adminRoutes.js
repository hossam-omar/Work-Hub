import express from "express";
import valMiddleware, {
  validateObjectIdParams,
} from "../../middleware/val.middleware.js";
import {
  addAdmin,
  deleteAdmin,
  getAdminById,
  getAllAdmins,
  updateAdminInfo,
  updateAdminPassword,
  uploadAdminImage,
} from "./adminController.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  createAdminSchema,
  getAdminsQuerySchema,
  updateAdminPasswordSchema,
  updateInfoSchema,
} from "./adminSchema.js";
import auth from "../../middleware/auth.middleware.js";
import endPoints from "../../middleware/endPoints.js";
import { uploadImage } from "../../middleware/uploadImages.js";

const router = express.Router();

router.get(
  "/getAllAdmins",
  auth(endPoints.admin),
  valMiddleware(getAdminsQuerySchema, {
    source: "query",
    assignValidatedData: true,
  }),
  asyncHandler(getAllAdmins),
);
router.get(
  "/getAdminById/:id",
  auth(endPoints.admin),
  validateObjectIdParams("id"),
  asyncHandler(getAdminById),
);
router.post(
  "/addAdmin",
  auth(endPoints.admin),
  valMiddleware(createAdminSchema, { assignValidatedData: true }),
  asyncHandler(addAdmin),
);
router.put(
  "/uploadAdminImage",
  auth(endPoints.admin),
  uploadImage("image"),
  asyncHandler(uploadAdminImage),
);
router.put(
  "/updateAdminInfo/:id",
  auth(endPoints.admin),
  validateObjectIdParams("id"),
  valMiddleware(updateInfoSchema, { assignValidatedData: true }),
  asyncHandler(updateAdminInfo),
);
router.put(
  "/updateAdminPassword",
  auth(endPoints.admin),
  valMiddleware(updateAdminPasswordSchema, { assignValidatedData: true }),
  asyncHandler(updateAdminPassword),
);
router.delete(
  "/deleteAdmin/:id",
  auth(endPoints.admin),
  validateObjectIdParams("id"),
  asyncHandler(deleteAdmin),
);

export default router;

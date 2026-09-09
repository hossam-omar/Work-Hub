import express from "express";
import { unlink } from "fs/promises";
import valMiddleware, {
  validateParams,
} from "../../middleware/val.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import auth from "../../middleware/auth.middleware.js";
import endPoints from "../../middleware/endPoints.js";
import login, { logout, signup } from "./authController.js";
import { loginSchema, signupSchema } from "./authSchema.js";
import { uploadImage } from "../../middleware/uploadImages.js";

const router = express.Router();

const cleanupUploadedFileOnFailedSignup = (req, res, next) => {
  if (!req.file?.path) return next();

  const uploadedFilePath = req.file.path;

  res.on("finish", () => {
    if (res.statusCode < 400) return;

    unlink(uploadedFilePath).catch((error) => {
      if (error.code !== "ENOENT") {
        console.error("Failed to remove uploaded signup image:", error);
      }
    });
  });

  return next();
};

router.post(
  "/signup/:role",
  uploadImage("image"),
  cleanupUploadedFileOnFailedSignup,
  valMiddleware(signupSchema, {
    includeParams: true,
    assignValidatedData: true,
  }),
  asyncHandler(signup),
);
router.post(
  "/login",
  valMiddleware(loginSchema, { assignValidatedData: true }),
  asyncHandler(login),
);
router.put(
  "/logout/:id",
  auth(endPoints.allUsers),
  validateParams(),
  asyncHandler(logout),
);

export default router;

import bcrypt from "bcryptjs";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import AdminModel from "../../../DB/models/admin_model.js";
import { validatePassword } from "../../middleware/val.middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../../uploads");
const defaultSaltRounds = 10;

const adminResponseFields = [
  "_id",
  "name",
  "email",
  "image_url",
  "activityStatus",
  "lastLogin",
  "role",
  "createdAt",
  "updatedAt",
];

const sanitizeAdmin = (admin) => {
  const adminObject = admin?.toObject ? admin.toObject() : { ...admin };

  return adminResponseFields.reduce((safeAdmin, field) => {
    if (adminObject[field] !== undefined) {
      safeAdmin[field] = adminObject[field];
    }

    return safeAdmin;
  }, {});
};

const isDuplicateEmailError = (error) => {
  return (
    error?.code === 11000 &&
    (error?.keyPattern?.email || error?.keyValue?.email)
  );
};

const getSaltRounds = () => {
  const configuredRounds = Number(process.env.SALT_ROUND);

  return Number.isInteger(configuredRounds) &&
    configuredRounds >= 4 &&
    configuredRounds <= 31
    ? configuredRounds
    : defaultSaltRounds;
};

const buildAdminImageUrl = (req, filename) => {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
};

const getSafeUploadedFilePath = (imageUrl, req) => {
  if (!imageUrl || typeof imageUrl !== "string") {
    return null;
  }

  let pathname = imageUrl;

  if (URL.canParse(imageUrl)) {
    const parsedUrl = new URL(imageUrl);

    if (
      parsedUrl.host === req.get("host") &&
      parsedUrl.pathname.startsWith("/uploads/")
    ) {
      pathname = parsedUrl.pathname;
    } else {
      return null;
    }
  }

  const normalizedFile = pathname
    .replace(/^\/+uploads\/+/i, "")
    .replace(/^uploads\/+/i, "");

  if (
    !normalizedFile ||
    normalizedFile.includes("/") ||
    normalizedFile.includes("\\")
  ) {
    return null;
  }

  const filePath = path.resolve(uploadsDir, normalizedFile);

  if (!filePath.startsWith(`${uploadsDir}${path.sep}`)) {
    return null;
  }

  return filePath;
};

const cleanupUploadedFile = async (filePath) => {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // Best-effort cleanup only; upload responses should not fail on stale files.
  }
};

// Get All Admins
export const getAllAdmins = async (req, res) => {
  const { page, limit } = req.query;
  const skip = (page - 1) * limit;
  const [admins, totalAdmins] = await Promise.all([
    AdminModel.find()
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AdminModel.countDocuments(),
  ]);
  const totalPages = Math.ceil(totalAdmins / limit);

  return res.status(200).json({
    message: "Admins retrieved successfully",
    admins: admins.map(sanitizeAdmin),
    pagination: {
      page,
      limit,
      totalAdmins,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  });
};

// Get Admin By ID
export const getAdminById = async (req, res) => {
  const admin = await AdminModel.findById(req.params.id).lean();

  if (!admin) {
    return res.status(404).json({ message: "Admin not found" });
  }

  return res.status(200).json({
    message: "Admin retrieved successfully",
    admin: sanitizeAdmin(admin),
  });
};

// Add Admin
export const addAdmin = async (req, res) => {
  const { name, email, password, image_url, activityStatus } = req.body;

  const admin = await AdminModel.findOne({ email });
  if (admin) {
    return res.status(409).json({ message: "Email already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, getSaltRounds());

  const newAdmin = new AdminModel({
    name,
    email,
    password: hashedPassword,
    image_url,
    activityStatus,
  });

  try {
    await newAdmin.save();
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: "Email already exists" });
    }

    throw error;
  }

  return res.status(201).json({
    message: "Admin added successfully",
    admin: sanitizeAdmin(newAdmin),
  });
};

// Update Admin Info
export const updateAdminInfo = async (req, res) => {
  const adminId = req.params.id;
  const editableFields = ["name", "email", "image_url"];
  const updateData = {};

  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ message: "No valid admin fields provided" });
  }

  const adminToUpdate = await AdminModel.findById(adminId);

  if (!adminToUpdate) {
    return res.status(404).json({ message: "Admin not found" });
  }

  if (updateData.email !== undefined) {
    const existingAdmin = await AdminModel.findOne({
      _id: { $ne: adminId },
      email: updateData.email,
    });

    if (existingAdmin) {
      return res.status(409).json({ message: "Email already exists" });
    }
  }

  Object.assign(adminToUpdate, updateData);

  try {
    await adminToUpdate.save();
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ message: "Email already exists" });
    }

    throw error;
  }

  return res.status(200).json({
    message: "Admin has been updated successfully.",
    admin: sanitizeAdmin(adminToUpdate),
  });
};

// Update Admin Password
export const updateAdminPassword = async (req, res) => {
  const adminId = req.user._id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Password fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Passwords don't match" });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({
      message: "Password is not valid. Please follow the password pattern.",
    });
  }

  const adminToUpdate = await AdminModel.findById(adminId).select("+password");

  if (!adminToUpdate) {
    return res.status(404).json({ message: "Admin not found" });
  }

  const passwordMatches = await bcrypt.compare(
    currentPassword,
    adminToUpdate.password,
  );

  if (!passwordMatches) {
    return res.status(400).json({ message: "Wrong password" });
  }

  const newPasswordMatchesCurrent = await bcrypt.compare(
    newPassword,
    adminToUpdate.password,
  );

  if (newPasswordMatchesCurrent) {
    return res
      .status(400)
      .json({ message: "You cannot use your current password as new password" });
  }

  adminToUpdate.password = await bcrypt.hash(newPassword, getSaltRounds());

  await adminToUpdate.save();

  return res.status(200).json({
    message: "Admin password has been updated successfully.",
    admin: sanitizeAdmin(adminToUpdate),
  });
};

// Upload Admin Image
export const uploadAdminImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Image is required" });
  }

  const adminId = req.user._id;
  const uploadedFilePath = req.file.path;
  const adminToUpdate = await AdminModel.findById(adminId);

  if (!adminToUpdate) {
    await cleanupUploadedFile(uploadedFilePath);
    return res.status(404).json({ message: "Admin not found" });
  }

  const previousImagePath = getSafeUploadedFilePath(
    adminToUpdate.image_url,
    req,
  );
  adminToUpdate.image_url = buildAdminImageUrl(req, req.file.filename);

  try {
    await adminToUpdate.save();
  } catch (error) {
    await cleanupUploadedFile(uploadedFilePath);
    throw error;
  }

  if (previousImagePath && previousImagePath !== uploadedFilePath) {
    await cleanupUploadedFile(previousImagePath);
  }

  return res.status(200).json({
    message: "Image uploaded successfully",
    admin: sanitizeAdmin(adminToUpdate),
    image_url: adminToUpdate.image_url,
  });
};

// Delete Admin
export const deleteAdmin = async (req, res) => {
  const adminId = req.params.id;
  const adminToDelete = await AdminModel.findById(adminId);

  if (!adminToDelete) {
    return res.status(404).json({ message: "Admin not found" });
  }

  if (adminToDelete._id.equals(req.user._id)) {
    return res.status(409).json({
      message: "You cannot delete your currently authenticated admin account",
    });
  }

  const adminCount = await AdminModel.countDocuments();

  if (adminCount <= 1) {
    return res.status(409).json({
      message: "The last remaining admin cannot be deleted",
    });
  }

  const imagePath = getSafeUploadedFilePath(adminToDelete.image_url, req);
  const deletionResult = await AdminModel.deleteOne({ _id: adminId });

  if (deletionResult.deletedCount === 0) {
    return res.status(404).json({ message: "Admin not found" });
  }

  await cleanupUploadedFile(imagePath);

  return res
    .status(200)
    .json({ message: "Admin has been deleted successfully." });
};

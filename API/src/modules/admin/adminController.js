import bcrypt from "bcryptjs";
import AdminModel from "../../../DB/models/admin_model.js";
import { validatePassword } from "../../middleware/val.middleware.js";

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
    error?.code === 11000 && (error?.keyPattern?.email || error?.keyValue?.email)
  );
};

// Get All Admins
export const getAllAdmins = async (req, res) => {
  const allAdmins = await AdminModel.find();

  return res.status(200).json(allAdmins.map(sanitizeAdmin));
};

// Add Admin
export const addAdmin = async (req, res) => {
  const { name, email, password, image_url, activityStatus } = req.body;

  const admin = await AdminModel.findOne({ email });
  if (admin) {
    return res.status(409).json({ msg: "Email already exists" });
  }

  const hashedPassword = await bcrypt.hash(
    password,
    parseInt(process.env.SALT_ROUND, 10),
  );

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
      return res.status(409).json({ msg: "Email already exists" });
    }

    throw error;
  }

  return res.status(201).json({
    msg: "Admin added successfully",
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
    return res.status(400).json({ msg: "No valid admin fields provided" });
  }

  const adminToUpdate = await AdminModel.findById(adminId);

  if (!adminToUpdate) {
    return res.status(404).json({ msg: "Admin not found" });
  }

  if (updateData.email !== undefined) {
    const existingAdmin = await AdminModel.findOne({
      _id: { $ne: adminId },
      email: updateData.email,
    });

    if (existingAdmin) {
      return res.status(409).json({ msg: "Email already exists" });
    }
  }

  Object.assign(adminToUpdate, updateData);

  try {
    await adminToUpdate.save();
  } catch (error) {
    if (isDuplicateEmailError(error)) {
      return res.status(409).json({ msg: "Email already exists" });
    }

    throw error;
  }

  return res.status(200).json({
    msg: "Admin has been updated successfuly.",
    admin: sanitizeAdmin(adminToUpdate),
  });
};

// Update Admin Password
export const updateAdminPassword = async (req, res) => {
  const adminId = req.params.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ msg: "Password fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ msg: "Passwords don't match" });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({
      msg: "Password is not valid. Please follow the password pattern.",
    });
  }

  const adminToUpdate = await AdminModel.findById(adminId).select("+password");

  if (!adminToUpdate) {
    return res.status(404).json({ msg: "Admin not found" });
  }

  const passwordMatches = await bcrypt.compare(
    currentPassword,
    adminToUpdate.password,
  );

  if (!passwordMatches) {
    return res.status(400).json({ msg: "Wrong password" });
  }

  const newPasswordMatchesCurrent = await bcrypt.compare(
    newPassword,
    adminToUpdate.password,
  );

  if (newPasswordMatchesCurrent) {
    return res
      .status(400)
      .json({ msg: "You cannot use your current password as new password" });
  }

  adminToUpdate.password = await bcrypt.hash(
    newPassword,
    parseInt(process.env.SALT_ROUND, 10),
  );

  await adminToUpdate.save();

  return res.status(200).json({
    msg: "Admin password has been updated successfully.",
    admin: sanitizeAdmin(adminToUpdate),
  });
};

// Upload Admin Image
export const uploadAdminImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(404)
        .send({ success: false, message: "Image is required" });
    }

    const id = req.params.id;

    if (id == undefined) {
      return res
        .status(404)
        .send({ success: false, message: "id is required" });
    }

    const cover_url = req.file.filename;

    const filter = { _id: id };
    const update = { $set: { image_url: cover_url } };

    await AdminModel.updateOne(filter, update);

    res.status(200).json({ msg: "image uploaded successfuly" });
  } catch (error) {
    res.status(404).json({ success: false, message: "Server Error" });
  }
};

// Delete Admin
export const deleteAdmin = async (req, res) => {
  const adminId = req.params.id;
  const adminToDelete = await AdminModel.findById(adminId);

  if (!adminToDelete) {
    return res.status(404).json({ msg: "Admin not found" });
  }

  await AdminModel.deleteOne({ _id: adminId });

  return res.status(200).json({ msg: "Admin has been deleted successfuly." });
};

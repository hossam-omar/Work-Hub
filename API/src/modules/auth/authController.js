import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import AdminModel from "../../../DB/models/admin_model.js";
import ClientModel from "../../../DB/models/client_model.js";
import FreelancerModel from "../../../DB/models/freelancer_model.js";
import {
  authenticatedFreelancerProjection,
  freelancerAuthenticationProjection,
  toAuthenticatedFreelancer,
} from "../freelancer/freelancerRepresentations.js";

const userModelsByRole = {
  admin: AdminModel,
  client: ClientModel,
  freelancer: FreelancerModel,
};

const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.TOKEN_SECRETkEY, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
};

const getSaltRounds = () => {
  const saltRounds = Number.parseInt(process.env.SALT_ROUND, 10);

  return Number.isInteger(saltRounds) && saltRounds > 0 ? saltRounds : 10;
};

const getUserModelByRole = (role) => userModelsByRole[role];

const findUserByEmail = async (email) => {
  for (const [role, UserModel] of Object.entries(userModelsByRole)) {
    const user = await UserModel.findOne(
      { email },
      role === "freelancer" ? freelancerAuthenticationProjection : undefined,
    ).select("+password");
    if (user) return { role, user };
  }

  return null;
};

const findUserByIdAndRole = async (id, role) => {
  const UserModel = getUserModelByRole(role);
  if (!UserModel) return null;

  return UserModel.findById(
    id,
    role === "freelancer" ? authenticatedFreelancerProjection : undefined,
  );
};

const updateUserByRole = async (role, filter, update) => {
  const UserModel = getUserModelByRole(role);
  if (!UserModel) return null;

  return UserModel.updateOne(filter, update);
};

const sanitizeUser = (user) => {
  const userObject = user?.toObject ? user.toObject() : { ...user };

  delete userObject.password;
  delete userObject.token;
  delete userObject.__v;

  return userObject;
};

const buildUploadUrl = (filename, req) => {
  if (!filename) return filename;
  if (/^https?:\/\//i.test(filename)) return filename;

  const normalizedPath = filename.startsWith("/uploads/")
    ? filename
    : `/uploads/${filename}`;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  return `${baseUrl}${normalizedPath}`;
};

const buildAuthUserResponse = (user, req, role = user?.role) => {
  if (role === "freelancer") {
    return toAuthenticatedFreelancer(user, {
      buildUploadUrl: (filename) => buildUploadUrl(filename, req),
    });
  }

  const userObject = sanitizeUser(user);

  if (userObject.image_url) {
    userObject.image_url = buildUploadUrl(userObject.image_url, req);
  }

  if (userObject.coverImage_url) {
    userObject.coverImage_url = buildUploadUrl(userObject.coverImage_url, req);
  }

  return userObject;
};

const normalizeStringArray = (value) => {
  if (value === undefined || value === null || value === "") return [];

  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => {
      if (item === undefined || item === null) return [];
      if (Array.isArray(item)) return item;

      const text = String(item).trim();
      if (!text) return [];

      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not JSON; treat it as a comma-separated or single value below.
      }

      return text.split(",");
    })
    .map((item) => String(item).trim())
    .filter(Boolean);
};

const login = async (req, res) => {
  const { email, password } = req.body;
  const authenticatedAccount = await findUserByEmail(email);

  if (!authenticatedAccount) {
    return res.status(401).json({ message: "Wrong email or password" });
  }

  const { user, role } = authenticatedAccount;

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ message: "Wrong email or password" });
  }

  const token = generateToken(user._id, role);
  const filter = { _id: user._id };
  const update = {
    $set: { lastLogin: new Date(), activityStatus: "online", token: token },
  };

  const updateResult = await updateUserByRole(role, filter, update);
  if (!updateResult) {
    return res.status(400).json({ message: "Role undefined" });
  }

  const userData = await findUserByIdAndRole(user._id, role);

  const responseUser = buildAuthUserResponse(userData, req, role);

  res
    .status(200)
    .json({ message: "Sign in successful", token, user: responseUser });
};

export const logout = async (req, res) => {
  const { id } = req.params;
  const authenticatedUser = req.user;

  if (!authenticatedUser) {
    return res.status(401).json({ message: "You are not authenticated" });
  }

  if (id !== String(authenticatedUser._id)) {
    return res.status(403).json({ message: "You are not authorized" });
  }

  const filter = { _id: authenticatedUser._id };
  const update = { $set: { activityStatus: "offline", token: null } };

  const updateResult = await updateUserByRole(
    authenticatedUser.role,
    filter,
    update,
  );

  if (!updateResult) {
    return res.status(400).json({ message: "Role undefined" });
  }

  return res.status(200).json({ message: "logged out successfully." });
};

export const signup = async (req, res) => {
  const { role } = req.params;
  const {
    name,
    email,
    password,
    country,
    desc,
    phoneNumber,
    skills,
    languages,
    specialization,
  } = req.body;
  let image_url;

  if (!password) {
    return res.status(400).json({ message: "You should enter password" });
  }
  if (req.file) {
    image_url = req.file.filename;
  }

  if (!["client", "freelancer"].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    return res.status(400).json({ message: "This Email is used" });
  }

  const hashedPassword = await bcrypt.hash(password, getSaltRounds());

  let newUser;
  switch (role) {
    case "client":
      newUser = new ClientModel({
        name,
        email,
        password: hashedPassword,
        country,
        image_url,
      });
      break;
    case "freelancer":
      newUser = new FreelancerModel({
        name,
        email,
        password: hashedPassword,
        country,
        image_url,
        desc,
        phoneNumber,
        skills: normalizeStringArray(skills),
        languages: normalizeStringArray(languages),
        specialization,
      });
      break;
  }

  await newUser.save();

  const token = generateToken(newUser._id, role);
  const filter = { _id: newUser._id };
  const update = { $set: { token: token, activityStatus: "online" } };
  await updateUserByRole(role, filter, update);

  const savedAccount = await findUserByEmail(email);
  const responseUser = buildAuthUserResponse(savedAccount?.user, req, role);

  return res.status(201).json({
    message: "User created successfully",
    token,
    user: responseUser,
  });
};

export default login;

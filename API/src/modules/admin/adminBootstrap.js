import bcrypt from "bcryptjs";
import AdminModel from "../../../DB/models/admin_model.js";
import ClientModel from "../../../DB/models/client_model.js";
import FreelancerModel from "../../../DB/models/freelancer_model.js";
import { parseSaltRounds } from "../../config/saltRounds.js";
import { createAdminSchema } from "./adminSchema.js";

const initialAdminBootstrapKey = "initial-admin";

const requiredEnvironmentVariables = [
  "CONNECTION_URL",
  "INITIAL_ADMIN_NAME",
  "INITIAL_ADMIN_EMAIL",
  "INITIAL_ADMIN_PASSWORD",
];

const validationMessages = {
  name: "INITIAL_ADMIN_NAME must be non-empty and at most 100 characters",
  email:
    "INITIAL_ADMIN_EMAIL must be a valid email address of at most 254 characters",
  password:
    "INITIAL_ADMIN_PASSWORD must meet the protected Admin creation password requirements",
};

export class AdminBootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

const isMissingEnvironmentValue = (value) => {
  return typeof value !== "string" || value.trim() === "";
};

const formatValidationFailure = (details) => {
  const messages = details.map((detail) => {
    return (
      validationMessages[detail.path[0]] ||
      "The initial Admin values are invalid"
    );
  });

  return [...new Set(messages)].join("; ");
};

const isDuplicateEmailError = (error) => {
  return (
    error?.code === 11000 &&
    (error?.keyPattern?.email || error?.keyValue?.email)
  );
};

const isDuplicateBootstrapError = (error) => {
  return (
    error?.code === 11000 &&
    (error?.keyPattern?.bootstrapKey || error?.keyValue?.bootstrapKey)
  );
};

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const adminAccountExists = async (adminModel) => {
  try {
    return Boolean(await adminModel.exists({}));
  } catch {
    throw new AdminBootstrapError(
      "Unable to check whether an Admin account already exists",
    );
  }
};

export const getBootstrapConfiguration = (environment = process.env) => {
  const missingVariables = requiredEnvironmentVariables.filter((name) => {
    return isMissingEnvironmentValue(environment[name]);
  });

  if (missingVariables.length > 0) {
    throw new AdminBootstrapError(
      `Missing or empty required environment variable(s): ${missingVariables.join(", ")}`,
    );
  }

  let saltRounds;

  try {
    saltRounds = parseSaltRounds(environment.SALT_ROUND);
  } catch (error) {
    throw new AdminBootstrapError(error.message);
  }

  const validationResult = createAdminSchema.validate(
    {
      name: environment.INITIAL_ADMIN_NAME,
      email: environment.INITIAL_ADMIN_EMAIL,
      password: environment.INITIAL_ADMIN_PASSWORD,
    },
    { abortEarly: false },
  );

  if (validationResult.error) {
    throw new AdminBootstrapError(
      `Initial Admin validation failed: ${formatValidationFailure(
        validationResult.error.details,
      )}`,
    );
  }

  return {
    connectionUrl: environment.CONNECTION_URL.trim(),
    credentials: validationResult.value,
    saltRounds,
  };
};

export const bootstrapFirstAdmin = async (
  { credentials, saltRounds },
  {
    adminModel = AdminModel,
    clientModel = ClientModel,
    freelancerModel = FreelancerModel,
    hashPassword = bcrypt.hash,
  } = {},
) => {
  if (await adminAccountExists(adminModel)) {
    throw new AdminBootstrapError(
      "An Admin account already exists; bootstrap is allowed only when the Admin collection is empty",
    );
  }

  try {
    await adminModel.createIndexes();
  } catch {
    throw new AdminBootstrapError(
      "Unable to prepare the database guard for one-time Admin bootstrap",
    );
  }

  if (await adminAccountExists(adminModel)) {
    throw new AdminBootstrapError(
      "An Admin account was created before this bootstrap command could continue",
    );
  }

  const emailPattern = new RegExp(
    `^${escapeRegularExpression(credentials.email)}$`,
    "i",
  );

  let emailMatches;

  try {
    emailMatches = await Promise.all([
      adminModel.exists({ email: emailPattern }),
      clientModel.exists({ email: emailPattern }),
      freelancerModel.exists({ email: emailPattern }),
    ]);
  } catch {
    throw new AdminBootstrapError(
      "Unable to verify whether the initial Admin email is available",
    );
  }

  if (emailMatches.some(Boolean)) {
    throw new AdminBootstrapError(
      "The initial Admin email is already used by an existing account",
    );
  }

  let hashedPassword;

  try {
    hashedPassword = await hashPassword(credentials.password, saltRounds);
  } catch {
    throw new AdminBootstrapError(
      "Unable to hash the initial Admin password",
    );
  }

  let createdAdmin;

  try {
    createdAdmin = await adminModel.create({
      name: credentials.name,
      email: credentials.email,
      password: hashedPassword,
      role: "admin",
      activityStatus: "offline",
      bootstrapKey: initialAdminBootstrapKey,
    });
  } catch (error) {
    if (isDuplicateBootstrapError(error)) {
      throw new AdminBootstrapError(
        "Another bootstrap command created the first Admin before this command completed",
      );
    }

    if (isDuplicateEmailError(error)) {
      throw new AdminBootstrapError(
        "The initial Admin email became unavailable before creation completed",
      );
    }

    throw new AdminBootstrapError(
      "Unable to create the initial Admin account because the database write failed",
    );
  }

  return {
    id: String(createdAdmin._id),
    email: createdAdmin.email,
  };
};

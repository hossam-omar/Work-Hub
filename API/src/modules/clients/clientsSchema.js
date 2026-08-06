
import Joi from "joi";
import { validatePassword } from "../../middleware/val.middleware.js";
import {
  clientPasswordConfirmationMismatch,
  invalidClientId,
  invalidClientPagination,
  invalidClientProfileValues,
  invalidClientRequest,
  invalidNewClientPassword,
} from "./clientErrors.js";

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const clientPasswordFields = [
  "currentPassword",
  "newPassword",
  "confirmPassword",
];
const clientPasswordFieldSet = new Set(clientPasswordFields);
const clientDeletionFields = ["currentPassword"];
const clientDeletionFieldSet = new Set(clientDeletionFields);
const clientProfileUpdateFields = ["name", "email"];
const clientProfileUpdateFieldSet = new Set(clientProfileUpdateFields);
const clientProfileValidationMessages = Object.freeze({
  name: "Name must be between 2 and 100 characters.",
  email: "Email must be a valid email address.",
});
const clientProfileEmailSchema = Joi.string()
  .trim()
  .lowercase()
  .max(254)
  .email({ tlds: { allow: false } });
const positiveIntegerQueryValue = Joi.string().pattern(/^\d+$/);
const publicClientListQueryShape = {
  page: positiveIntegerQueryValue.optional(),
  limit: positiveIntegerQueryValue.optional(),
};
const publicClientListQueryFields = new Set(
  Object.keys(publicClientListQueryShape),
);

const assertClientMutationRequestStructure = ({
  allowedFields,
  body,
  maximumFieldCount,
  minimumFieldCount,
  params,
  query,
}) => {
  const bodyIsObject =
    body !== null && typeof body === "object" && !Array.isArray(body);
  const bodyFields = bodyIsObject ? Object.keys(body) : [];
  const hasValidFieldCount =
    bodyFields.length >= minimumFieldCount &&
    bodyFields.length <= maximumFieldCount;
  const hasOnlyAllowedFields =
    hasValidFieldCount &&
    bodyFields.every((field) => allowedFields.has(field));

  if (
    Object.keys(params).length !== 0 ||
    Object.keys(query).length !== 0 ||
    !hasOnlyAllowedFields
  ) {
    throw invalidClientRequest();
  }

};

export const publicClientListQuerySchema = Joi.object(
  publicClientListQueryShape,
).unknown(false);

export const parsePublicClientListQuery = (query = {}) => {
  const hasUnknownField = Object.keys(query).some((field) => {
    return !publicClientListQueryFields.has(field);
  });

  if (hasUnknownField) {
    throw invalidClientRequest();
  }

  const validationResult = publicClientListQuerySchema.validate(query, {
    abortEarly: false,
    convert: false,
  });

  if (validationResult.error) {
    throw invalidClientPagination();
  }

  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  const skip = (page - 1) * limit;

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(skip)
  ) {
    throw invalidClientPagination();
  }

  return { page, limit };
};

export const parsePublicClientLookupRequest = ({
  params = {},
  query = {},
} = {}) => {
  if (
    Object.keys(params).length !== 1 ||
    !Object.hasOwn(params, "id") ||
    Object.keys(query).length !== 0
  ) {
    throw invalidClientRequest();
  }

  if (
    typeof params.id !== "string" ||
    !objectIdPattern.test(params.id)
  ) {
    throw invalidClientId();
  }

  return params.id;
};

export const parseClientPasswordRequest = ({
  body,
  params = {},
  query = {},
} = {}) => {
  assertClientMutationRequestStructure({
    allowedFields: clientPasswordFieldSet,
    body,
    maximumFieldCount: clientPasswordFields.length,
    minimumFieldCount: clientPasswordFields.length,
    params,
    query,
  });
  const allValuesAreStrings =
    clientPasswordFields.every((field) => typeof body[field] === "string");

  if (!allValuesAreStrings) {
    throw invalidClientRequest();
  }

  if (body.confirmPassword !== body.newPassword) {
    throw clientPasswordConfirmationMismatch();
  }

  if (!validatePassword(body.newPassword)) {
    throw invalidNewClientPassword();
  }

  return Object.fromEntries(
    clientPasswordFields.map((field) => [field, body[field]]),
  );
};

export const parseClientDeletionRequest = ({
  body,
  params = {},
  query = {},
} = {}) => {
  assertClientMutationRequestStructure({
    allowedFields: clientDeletionFieldSet,
    body,
    maximumFieldCount: clientDeletionFields.length,
    minimumFieldCount: clientDeletionFields.length,
    params,
    query,
  });

  if (typeof body.currentPassword !== "string") {
    throw invalidClientRequest();
  }

  return { currentPassword: body.currentPassword };
};

export const parseClientProfileUpdateRequest = ({
  body,
  hasImage = false,
  isMultipart = false,
  params = {},
  query = {},
} = {}) => {
  if (
    isMultipart &&
    body !== null &&
    typeof body === "object" &&
    Object.values(body).some(Array.isArray)
  ) {
    throw invalidClientRequest();
  }

  assertClientMutationRequestStructure({
    allowedFields: clientProfileUpdateFieldSet,
    body,
    maximumFieldCount: clientProfileUpdateFields.length,
    minimumFieldCount: hasImage ? 0 : 1,
    params,
    query,
  });

  const errors = {};
  const normalizedUpdates = {};

  for (const field of clientProfileUpdateFields) {
    if (!Object.hasOwn(body, field)) continue;

    if (field === "name") {
      if (typeof body.name !== "string") {
        errors.name = clientProfileValidationMessages.name;
        continue;
      }

      const normalizedName = body.name.trim();
      const nameLength = Array.from(normalizedName).length;

      if (nameLength < 2 || nameLength > 100) {
        errors.name = clientProfileValidationMessages.name;
        continue;
      }

      normalizedUpdates.name = normalizedName;
      continue;
    }

    const emailValidation = clientProfileEmailSchema.validate(body.email);

    if (emailValidation.error) {
      errors.email = clientProfileValidationMessages.email;
      continue;
    }

    normalizedUpdates.email = emailValidation.value;
  }

  if (Object.keys(errors).length > 0) {
    throw invalidClientProfileValues(errors);
  }

  return normalizedUpdates;
};

export const clientSchema = Joi.object({
    clientName: Joi.string().required(),
    clientEmail: Joi.string()
        .email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required(),
    clientPassword: Joi.string().min(8).max(20).pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")).required(),
    clientConfirmPassword: Joi.string().min(8).max(20).pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")).required(),
    clientImage_url: Joi.string().required(),
    clientDesc: Joi.string().max(100).required(),
    clientCountry: Joi.string().required(),
    clientLastLogin: Joi.string().isoDate()
});

export const updateClientSchema = Joi.object({
    clientName: Joi.string(),
    clientEmail: Joi.string()
        .email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }),
    clientPassword: Joi.string().min(8).max(20).pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
    clientNewPassword: Joi.string().min(8).max(20).pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
    clientConfirmNewPassword: Joi.string().min(8).max(20).pattern(new RegExp("^(?=.?[A-Z])(?=.?[a-z])(?=.*?[0-9]).{8,}$")),
    clientImage_url: Joi.string(),
    clientDesc: Joi.string().max(100),
    clientCountry: Joi.string(),
    clientLastLogin: Joi.string().isoDate()
});


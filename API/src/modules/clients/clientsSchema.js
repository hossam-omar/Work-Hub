
import Joi from "joi";
import {
  invalidClientPagination,
  invalidClientRequest,
} from "./clientErrors.js";

const positiveIntegerQueryValue = Joi.string().pattern(/^\d+$/);
const publicClientListQueryShape = {
  page: positiveIntegerQueryValue.optional(),
  limit: positiveIntegerQueryValue.optional(),
};
const publicClientListQueryFields = new Set(
  Object.keys(publicClientListQueryShape),
);

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

export const updateInfoSchema = Joi.object({
    name: Joi.string(),
    email: Joi.string()
        .email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }),
    image_url: Joi.string(),
});


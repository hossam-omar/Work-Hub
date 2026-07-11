import { Types } from "mongoose";

const objectIdPattern = /^[a-f\d]{24}$/i;

export const isValidObjectId = (value) => {
  const objectId = value instanceof Types.ObjectId ? value.toString() : value;

  return (
    typeof objectId === "string" &&
    objectIdPattern.test(objectId) &&
    Types.ObjectId.isValid(objectId)
  );
};

export const objectIdValidation = (value, helper) => {
  if (isValidObjectId(value)) return true;
  return helper.message("Invalid ObjectId");
};

export const validateObjectIdParams = (...paramNames) => {
  return (req, res, next) => {
    for (const paramName of paramNames) {
      if (!isValidObjectId(req.params[paramName])) {
        return res
          .status(400)
          .json({ message: `${paramName} must be a valid ObjectId` });
      }
    }

    return next();
  };
};

export const validation = (Schema) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query };
    const validationResult = Schema.validate(data, {
      abortEarly: false,
    });
    if (validationResult.error) {
      return next(new Error(validationResult.error.message, { cause: 400 }));
    }
    next();
  };
};

export const validateParams = () => {
  return (req, res, next) => {
    const { id } = req.params;

    if (!id || id === ":id") {
      return res.status(400).send("Id is required");
    }

    if (typeof id !== "string") {
      return res.status(400).send("Id should be string");
    }

    if (!isValidObjectId(id)) {
      return res.status(400).send("Invalid ObjectId");
    }

    return next();
  };
};

const passwordPattern =
  /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%^&+=!])(?=\S+$).{8,}$/;

export const validatePassword = (password) => {
  return passwordPattern.test(password);
};

const valMiddleware = (Schema, options = {}) => {
  return (req, res, next) => {
    const validationErrors = [];
    const data =
      options.source === "query"
        ? { ...req.query }
        : options.includeParams
          ? { ...req.params, ...req.body }
          : { ...req.body };
    const validationResult = Schema.validate(data, { abortEarly: false });

    if (validationResult.error) {
      validationResult.error.details.forEach((errorDetail) => {
        validationErrors.push(errorDetail.message);
      });
    }

    if (validationErrors.length > 0) {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: validationErrors });
    }

    if (options.assignValidatedData) {
      if (options.source === "query") {
        Object.keys(req.query).forEach((key) => delete req.query[key]);
        Object.assign(req.query, validationResult.value);
        return next();
      }

      const paramKeys = new Set(Object.keys(req.params));
      req.body = Object.fromEntries(
        Object.entries(validationResult.value).filter(([key]) => {
          return !paramKeys.has(key);
        }),
      );
    }

    next();
  };
};

export default valMiddleware;

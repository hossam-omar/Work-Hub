import {
  ClientError,
  ClientValidationError,
  invalidClientRequest,
  unsupportedClientMediaType,
} from "./clientErrors.js";
import {
  parseClientPasswordRequest,
  parseClientProfileUpdateRequest,
} from "./clientsSchema.js";

const clientPasswordPathPattern = /^\/api\/v1\/clients\/me\/password\/?$/i;
const clientProfileUpdatePathPattern = /^\/api\/v1\/clients\/me\/?$/i;

const createClientParseErrorHandler = (pathPattern) => {
  return (error, req, res, next) => {
    const isTargetRequest =
      req.method === "PATCH" && pathPattern.test(req.path);

    if (isTargetRequest && error?.type === "entity.parse.failed") {
      const clientError = invalidClientRequest();

      return res
        .status(clientError.statusCode)
        .json({ message: clientError.message });
    }

    return next(error);
  };
};

export const handleClientPasswordRequestParseError =
  createClientParseErrorHandler(clientPasswordPathPattern);

export const handleClientProfileUpdateParseError =
  createClientParseErrorHandler(clientProfileUpdatePathPattern);

const createClientJsonRequestValidator = ({ localKey, parseRequest }) => {
  return (req, res, next) => {
    try {
      if (!req.is("application/json")) {
        throw unsupportedClientMediaType();
      }

      res.locals[localKey] = parseRequest({
        body: req.body,
        params: req.params,
        query: req.query,
      });

      return next();
    } catch (error) {
      if (error instanceof ClientValidationError) {
        return res.status(error.statusCode).json({
          message: error.message,
          errors: error.errors,
        });
      }

      if (error instanceof ClientError) {
        return res.status(error.statusCode).json({ message: error.message });
      }

      return next(error);
    }
  };
};

export const validateClientPasswordRequest =
  createClientJsonRequestValidator({
    localKey: "clientPasswordChange",
    parseRequest: parseClientPasswordRequest,
  });

export const validateClientProfileUpdateRequest =
  createClientJsonRequestValidator({
    localKey: "clientProfileUpdate",
    parseRequest: parseClientProfileUpdateRequest,
  });

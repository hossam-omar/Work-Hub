import {
  ClientError,
  invalidClientRequest,
  unsupportedClientMediaType,
} from "./clientErrors.js";
import { parseClientPasswordRequest } from "./clientsSchema.js";

const clientPasswordPathPattern = /^\/api\/v1\/clients\/me\/password\/?$/i;

export const handleClientPasswordRequestParseError = (
  error,
  req,
  res,
  next,
) => {
  const isClientPasswordRequest =
    req.method === "PATCH" && clientPasswordPathPattern.test(req.path);

  if (isClientPasswordRequest && error?.type === "entity.parse.failed") {
    const clientError = invalidClientRequest();

    return res
      .status(clientError.statusCode)
      .json({ message: clientError.message });
  }

  return next(error);
};

export const validateClientPasswordRequest = (req, res, next) => {
  try {
    if (!req.is("application/json")) {
      throw unsupportedClientMediaType();
    }

    res.locals.clientPasswordChange = parseClientPasswordRequest({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    return next();
  } catch (error) {
    if (error instanceof ClientError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    return next(error);
  }
};

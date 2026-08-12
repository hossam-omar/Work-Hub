import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";

export const createRequestContextMiddleware = ({
  generateRequestId = randomUUID,
} = {}) => {
  return (req, res, next) => {
    const requestId = generateRequestId();

    req.id = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    return next();
  };
};

export const requestContext = createRequestContextMiddleware();

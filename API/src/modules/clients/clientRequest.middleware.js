import multer from "multer";
import {
  ClientError,
  ClientValidationError,
  invalidClientRequest,
  unsupportedClientMediaType,
} from "./clientErrors.js";
import {
  parseClientDeletionRequest,
  parseClientPasswordRequest,
  parseClientProfileUpdateRequest,
} from "./clientsSchema.js";
import {
  ClientImageLifecycleError,
  clientImageLifecycle,
} from "./clientImageLifecycle.js";

const clientPasswordPathPattern = /^\/api\/v1\/clients\/me\/password\/?$/i;
const clientProfileUpdatePathPattern = /^\/api\/v1\/clients\/me\/?$/i;

const createClientParseErrorHandler = (pathPattern, methods = ["PATCH"]) => {
  return (error, req, res, next) => {
    const isTargetRequest =
      methods.includes(req.method) && pathPattern.test(req.path);

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

export const handleClientDeletionParseError =
  createClientParseErrorHandler(clientProfileUpdatePathPattern, ["DELETE"]);

const respondToClientRequestValidationError = (error, res, next) => {
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
};

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
      return respondToClientRequestValidationError(error, res, next);
    }
  };
};

export const validateClientPasswordRequest =
  createClientJsonRequestValidator({
    localKey: "clientPasswordChange",
    parseRequest: parseClientPasswordRequest,
  });

export const validateClientDeletionRequest =
  createClientJsonRequestValidator({
    localKey: "clientDeletion",
    parseRequest: parseClientDeletionRequest,
  });

const createClientImageStagingStorage = (imageLifecycle) => ({
  _handleFile(req, file, callback) {
    imageLifecycle
      .stageUpload({
        stream: file.stream,
        originalName: file.originalname,
        mimeType: file.mimetype,
        correlationId: req.id,
      })
      .then((uploadHandle) => callback(null, { uploadHandle }))
      .catch(callback);
  },
  _removeFile(req, file, callback) {
    const uploadHandle = file.uploadHandle;
    delete file.uploadHandle;
    if (uploadHandle === undefined) return callback(null);

    imageLifecycle
      .discardStagedUpload(uploadHandle, {
        operation: "discard-rejected-client-image",
        correlationId: req.id,
      })
      .then(() => callback(null))
      .catch(() => callback(null));
  },
});

const discardMultipartUpload = async ({ imageLifecycle, req }) => {
  const uploadHandle = req.file?.uploadHandle;
  delete req.file;
  if (uploadHandle === undefined) return;

  try {
    await imageLifecycle.discardStagedUpload(uploadHandle, {
      operation: "discard-rejected-client-image",
      correlationId: req.id,
    });
  } catch {
    // The original request failure always takes precedence over cleanup.
  }
};

export const createClientProfileUpdateRequestHandler = ({
  imageLifecycle = clientImageLifecycle,
} = {}) => {
  const parseMultipart = multer({
    storage: createClientImageStagingStorage(imageLifecycle),
    limits: { fields: 2, files: 1 },
  }).single("image");

  return (req, res, next) => {
    if (req.is("application/json")) {
      try {
        res.locals.clientProfileUpdate = parseClientProfileUpdateRequest({
          body: req.body,
          params: req.params,
          query: req.query,
        });
        return next();
      } catch (error) {
        return respondToClientRequestValidationError(error, res, next);
      }
    }

    if (!req.is("multipart/form-data")) {
      return respondToClientRequestValidationError(
        unsupportedClientMediaType(),
        res,
        next,
      );
    }

    return parseMultipart(req, res, async (multipartError) => {
      if (multipartError) {
        if (multipartError instanceof ClientImageLifecycleError) {
          return next(multipartError);
        }
        return respondToClientRequestValidationError(
          invalidClientRequest(),
          res,
          next,
        );
      }

      const uploadHandle = req.file?.uploadHandle;
      try {
        res.locals.clientProfileUpdate = parseClientProfileUpdateRequest({
          body: req.body,
          hasImage: uploadHandle !== undefined,
          isMultipart: true,
          params: req.params,
          query: req.query,
        });
        if (uploadHandle !== undefined) {
          res.locals.clientProfileImageUploadHandle = uploadHandle;
        }
        delete req.file;
        return next();
      } catch (error) {
        await discardMultipartUpload({ imageLifecycle, req });
        return respondToClientRequestValidationError(error, res, next);
      }
    });
  };
};

export const validateClientProfileUpdateRequest =
  createClientProfileUpdateRequestHandler();

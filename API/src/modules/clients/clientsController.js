
import {
  ClientError,
  clientImagePayloadTooLarge,
  invalidClientImage,
} from "./clientErrors.js";
import { clientOperations } from "./clientsOperations.js";
import { parsePublicClientListQuery } from "./clientsSchema.js";
import {
  CLIENT_IMAGE_ERROR_CATEGORIES,
  ClientImageLifecycleError,
} from "./clientImageLifecycle.js";

const safeLogName = (name) =>
  typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
    ? name
    : "Error";

const safeLogCode = (code) =>
  typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code
    : "UNKNOWN";

const logClientFailure = ({
  logger,
  phase,
  operation,
  correlationId,
  error,
  category,
}) => {
  const record = {
    phase,
    operation,
    correlationId,
    name: safeLogName(error?.name),
    ...(category === undefined ? { code: safeLogCode(error?.code) } : {
      category,
    }),
  };

  try {
    const loggingResult = logger.error(record);
    if (loggingResult && typeof loggingResult.then === "function") {
      void Promise.resolve(loggingResult).catch(() => undefined);
    }
  } catch {
    // Logging must never replace the primary Client response.
  }
};

export const respondToClientError = ({
  error,
  res,
  logger = console,
  operation,
  correlationId,
  phase = "database",
}) => {
  if (error instanceof ClientImageLifecycleError) {
    if (
      error.category ===
      CLIENT_IMAGE_ERROR_CATEGORIES.TRANSPORT_SIZE_EXCEEDED
    ) {
      const mappedError = clientImagePayloadTooLarge();
      return res.status(mappedError.statusCode).json({
        message: mappedError.message,
      });
    }

    if (error.category !== CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE) {
      const mappedError = invalidClientImage();
      return res.status(mappedError.statusCode).json({
        message: mappedError.message,
      });
    }

    logClientFailure({
      logger,
      phase: "storage",
      operation,
      correlationId,
      error,
      category: error.category,
    });
    return res.status(500).json({ message: "Internal server error." });
  }

  if (error instanceof ClientError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  logClientFailure({
    logger,
    phase,
    operation,
    correlationId,
    error,
  });
  return res.status(500).json({ message: "Internal server error." });
};

export const createListPublicProfilesController = ({
  operations = clientOperations,
  logger = console,
} = {}) => {
  return async (req, res) => {
    try {
      const pagination = parsePublicClientListQuery(req.query);
      const result = await operations.listPublicProfiles(pagination);

      return res.status(200).json(result);
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to list public Client Profiles.",
        correlationId: req.id,
      });
    }
  };
};

export const listPublicProfiles = createListPublicProfilesController();

export const createGetPublicProfileByIdController = ({
  operations = clientOperations,
  logger = console,
} = {}) => {
  return async (req, res) => {
    try {
      const id = res.locals.publicClientProfileId;
      const client = await operations.getPublicProfileById(id);

      return res.status(200).json({ client });
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to get public Client Profile.",
        correlationId: req.id,
      });
    }
  };
};

export const getPublicProfileById = createGetPublicProfileByIdController();

export const createChangeClientPasswordController = ({
  operations = clientOperations,
  logger = console,
} = {}) => {
  return async (req, res) => {
    try {
      const { currentPassword, newPassword } =
        res.locals.clientPasswordChange;

      await operations.changePassword({
        clientId: req.user._id,
        currentPassword,
        newPassword,
      });

      return res.status(200).json({
        message: "Password updated successfully. Please sign in again.",
      });
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to change Client password.",
        correlationId: req.id,
      });
    }
  };
};

export const changeClientPassword =
  createChangeClientPasswordController();

export const createUpdateClientProfileController = ({
  operations = clientOperations,
  logger = console,
} = {}) => {
  return async (req, res) => {
    try {
      const client = await operations.updateProfile({
        clientId: req.user._id,
        updates: res.locals.clientProfileUpdate,
        ...(req.id === undefined ? {} : { correlationId: req.id }),
        ...(res.locals.clientProfileImageUploadHandle === undefined
          ? {}
          : {
              imageUploadHandle:
                res.locals.clientProfileImageUploadHandle,
            }),
      });

      return res.status(200).json({
        message: "Client profile updated successfully.",
        client,
      });
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to update Client profile.",
        correlationId: req.id,
      });
    }
  };
};

export const updateClientProfile =
  createUpdateClientProfileController();

export const createClientProfileUpdateErrorHandler = ({
  logger = console,
} = {}) => {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);

    return respondToClientError({
      error,
      res,
      logger,
      operation: "Failed to update Client profile.",
      correlationId: req.id,
    });
  };
};

export const handleClientProfileUpdateError =
  createClientProfileUpdateErrorHandler();

export const createDeleteClientController = ({
  operations = clientOperations,
  logger = console,
} = {}) => {
  return async (req, res) => {
    try {
      await operations.deleteAccount({
        clientId: req.user._id,
        currentPassword: res.locals.clientDeletion.currentPassword,
        ...(req.id === undefined ? {} : { correlationId: req.id }),
      });

      return res.status(200).json({
        message: "Client account deleted successfully.",
      });
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to delete Client account.",
        correlationId: req.id,
      });
    }
  };
};

export const deleteClient = createDeleteClientController();

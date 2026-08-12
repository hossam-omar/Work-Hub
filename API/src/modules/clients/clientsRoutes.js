
import express from "express";
import auth from "../../middleware/auth.middleware.js";
import {
  changeClientPassword,
  deleteClient,
  getPublicProfileById,
  handleClientProfileUpdateError,
  listPublicProfiles,
  respondToClientError,
  updateClientProfile,
} from "./clientsController.js";
import endPoints from "../../middleware/endPoints.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { parsePublicClientLookupRequest } from "./clientsSchema.js";
import {
  validateClientDeletionRequest,
  validateClientPasswordRequest,
  validateClientProfileUpdateRequest,
} from "./clientRequest.middleware.js";

export const createPublicClientLookupRequestValidator = ({
  parseRequest = parsePublicClientLookupRequest,
  logger = console,
} = {}) => {
  return (req, res, next) => {
    try {
      res.locals.publicClientProfileId = parseRequest({
        params: req.params,
        query: req.query,
      });

      return next();
    } catch (error) {
      return respondToClientError({
        error,
        res,
        logger,
        operation: "Failed to validate public Client Profile lookup.",
        correlationId: req.id,
        phase: "request",
      });
    }
  };
};

const validatePublicClientLookupRequest =
  createPublicClientLookupRequestValidator();

export const createClientsRouter = ({
  changePasswordHandler = changeClientPassword,
  clientAuthHandler = auth(endPoints.client),
  clientDeletionRequestHandler = validateClientDeletionRequest,
  clientPasswordRequestHandler = validateClientPasswordRequest,
  deleteClientHandler = deleteClient,
  getPublicProfileByIdHandler = getPublicProfileById,
  listPublicProfilesHandler = listPublicProfiles,
  updateProfileHandler = updateClientProfile,
  clientProfileRequestHandler = validateClientProfileUpdateRequest,
  clientProfileErrorHandler = handleClientProfileUpdateError,
} = {}) => {
  const router = express.Router();

  router.get("/", asyncHandler(listPublicProfilesHandler));
  router.delete(
    "/me",
    clientAuthHandler,
    clientDeletionRequestHandler,
    asyncHandler(deleteClientHandler),
  );
  router.patch(
    "/me/password",
    clientAuthHandler,
    clientPasswordRequestHandler,
    asyncHandler(changePasswordHandler),
  );
  router.patch(
    "/me",
    clientAuthHandler,
    clientProfileRequestHandler,
    asyncHandler(updateProfileHandler),
    clientProfileErrorHandler,
  );
  router.get(
    "/:id",
    validatePublicClientLookupRequest,
    asyncHandler(getPublicProfileByIdHandler),
  );
  return router;
};

export default createClientsRouter();


import express from "express";
import auth from "../../middleware/auth.middleware.js";
import {
  changeClientPassword,
  deleteClient,
  getPublicProfileById,
  listPublicProfiles,
  respondToClientError,
  updateClientProfile,
} from "./clientsController.js";
import endPoints from "../../middleware/endPoints.js";
import { validateParams } from "../../middleware/val.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { parsePublicClientLookupRequest } from "./clientsSchema.js";
import {
  validateClientPasswordRequest,
  validateClientProfileUpdateRequest,
} from "./clientRequest.middleware.js";

const validatePublicClientLookupRequest = (req, res, next) => {
  try {
    res.locals.publicClientProfileId = parsePublicClientLookupRequest({
      params: req.params,
      query: req.query,
    });

    return next();
  } catch (error) {
    return respondToClientError({
      error,
      res,
      operation: "Failed to validate public Client Profile lookup.",
    });
  }
};

export const createClientsRouter = ({
  changePasswordHandler = changeClientPassword,
  clientAuthHandler = auth(endPoints.client),
  clientPasswordRequestHandler = validateClientPasswordRequest,
  getPublicProfileByIdHandler = getPublicProfileById,
  listPublicProfilesHandler = listPublicProfiles,
  updateProfileHandler = updateClientProfile,
  clientProfileRequestHandler = validateClientProfileUpdateRequest,
} = {}) => {
  const router = express.Router();

  router.get("/", asyncHandler(listPublicProfilesHandler));
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
  );
  router.get(
    "/:id",
    validatePublicClientLookupRequest,
    asyncHandler(getPublicProfileByIdHandler),
  );
  router.delete(
    "/deleteClient/:id",
    validateParams(),
    asyncHandler(deleteClient),
  );

  return router;
};

export default createClientsRouter();

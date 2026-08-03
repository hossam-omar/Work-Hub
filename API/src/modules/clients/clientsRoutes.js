
import express from "express";
import auth from '../../middleware/auth.middleware.js'
import valMiddleware from '../../middleware/val.middleware.js'
import {
  changeClientPassword,
  getPublicProfileById,
  listPublicProfiles,
  respondToClientError,
  updateClientInfo,
} from './clientsController.js'
import endPoints from "../../middleware/endPoints.js";
import { validateParams } from "../../middleware/val.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { deleteClient } from "./clientsController.js";
import {
  parsePublicClientLookupRequest,
  updateInfoSchema,
} from "./clientsSchema.js";
import { validateClientPasswordRequest } from "./clientRequest.middleware.js";
import { upload } from "../../middleware/uploadImages.js";

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
} = {}) => {
  const router = express.Router();

  router.get("/", asyncHandler(listPublicProfilesHandler));
  router.patch(
    "/me/password",
    clientAuthHandler,
    clientPasswordRequestHandler,
    asyncHandler(changePasswordHandler),
  );
  router.get(
    "/:id",
    validatePublicClientLookupRequest,
    asyncHandler(getPublicProfileByIdHandler),
  );
  router.put('/updateClientInfo/:id', validateParams(), valMiddleware(updateInfoSchema), upload.single('image'), updateClientInfo); // auth(endPoints.client)
  router.delete("/deleteClient/:id", validateParams(), asyncHandler(deleteClient));

  return router;
};

export default createClientsRouter();

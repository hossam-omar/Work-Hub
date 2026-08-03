
import client from "../../../DB/models/client_model.js";
import { ClientError } from "./clientErrors.js";
import { clientOperations } from "./clientsOperations.js";
import { parsePublicClientListQuery } from "./clientsSchema.js";

export const respondToClientError = ({
  error,
  res,
  logger = console,
  operation,
  redactErrorDetails = false,
}) => {
  if (error instanceof ClientError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  const loggedError = redactErrorDetails
    ? { name: error?.name, code: error?.code }
    : error;

  logger.error(operation, loggedError);
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
        redactErrorDetails: true,
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
      });
    }
  };
};

export const updateClientProfile =
  createUpdateClientProfileController();
  
// Delete Client
export const deleteClient = async (req, res) => {
    try {
        const clientId = req.params.id
        const clientToDelete = await client.findById(clientId);

        if(clientToDelete){
            const filter = { _id: clientId };

            await client.deleteOne(filter);
            return res.status(200).send("Client has been deleted successfuly.");
        }

        res.status(200).send("Client deletion failed.");
    } catch (error) {
        console.log(error);
        res.status(500).send("Somthing went wrong!");
    }
}

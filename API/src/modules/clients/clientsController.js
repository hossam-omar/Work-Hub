
import client from "../../../DB/models/client_model.js";
import ClientModel from "../../../DB/models/client_model.js"
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
  
// Update Client Info
export const updateClientInfo = async (req, res) => {
    try {
  
        let update;
        console.log(req);
        if(!req.file) {
          update = { $set: { name: req.body.name, email: req.body.email } }
        }
        else {
          update = { $set: { name: req.body.name, email: req.body.email, image_url: req.file.filename } }
        }
  
        const clientId = req.params.id;
        console.log(clientId);
        const clientToUpdate = await ClientModel.findById(clientId);
  
        if(clientToUpdate) {
            const clientEmail = {email: req.body.email};
            const clientData = await ClientModel.find(clientEmail);
            console.log(clientData);
  
            let condition = clientData.length === 0;
  
            if(!condition) {
                condition = clientData[0].email === req.body.email;
            }
  
            if(condition) {
                const filter = { _id: clientId };

                await ClientModel.updateOne(filter, update);
                return res.status(200).json({ msg: "Client has been updated successfuly." });
            }
            return res.status(400).json({ msg: "You cannot use this email." });
        }
        res.status(200).json({ msg: "There is no Client with such id to update." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: "Somthing went wrong!" });
    }
}
  
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

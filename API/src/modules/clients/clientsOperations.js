import bcrypt from "bcryptjs";
import ClientModel from "../../../DB/models/client_model.js";
import { getSaltRounds } from "../../config/saltRounds.js";
import {
  clientAccountNotFound,
  clientPasswordChangeConflict,
  clientProfileNotFound,
  incorrectCurrentClientPassword,
  reusedCurrentClientPassword,
} from "./clientErrors.js";
import {
  publicClientProfileProjection,
  toPublicClientProfile,
} from "./clientRepresentations.js";

const publicClientProfileSort = Object.freeze({
  createdAt: -1,
  _id: -1,
});

export const createClientOperations = ({
  clientModel = ClientModel,
  getPasswordSaltRounds = getSaltRounds,
  passwordHasher = bcrypt,
} = {}) => {
  return {
    changePassword: async ({
      clientId,
      currentPassword,
      newPassword,
    }) => {
      const storedClient = await clientModel.findById(
        clientId,
        { password: 1 },
      ).lean();

      if (!storedClient) {
        throw clientAccountNotFound();
      }

      const currentPasswordMatches = await passwordHasher.compare(
        currentPassword,
        storedClient.password,
      );

      if (!currentPasswordMatches) {
        throw incorrectCurrentClientPassword();
      }

      const newPasswordMatches = await passwordHasher.compare(
        newPassword,
        storedClient.password,
      );

      if (newPasswordMatches) {
        throw reusedCurrentClientPassword();
      }

      const newPasswordHash = await passwordHasher.hash(
        newPassword,
        getPasswordSaltRounds(),
      );
      const updateResult = await clientModel.updateOne(
        {
          _id: clientId,
          password: storedClient.password,
        },
        {
          $set: {
            password: newPasswordHash,
            token: null,
            activityStatus: "offline",
          },
        },
      );

      if (updateResult.matchedCount === 0) {
        const clientStillExists = await clientModel.exists({
          _id: clientId,
        });

        if (!clientStillExists) {
          throw clientAccountNotFound();
        }

        throw clientPasswordChangeConflict();
      }
    },
    getPublicProfileById: async (id) => {
      const client = await clientModel
        .findById(id, publicClientProfileProjection)
        .lean();

      if (!client) {
        throw clientProfileNotFound();
      }

      return toPublicClientProfile(client);
    },
    listPublicProfiles: async ({ page, limit }) => {
      const skip = (page - 1) * limit;
      const [clients, totalClients] = await Promise.all([
        clientModel
          .find({}, publicClientProfileProjection)
          .sort(publicClientProfileSort)
          .skip(skip)
          .limit(limit)
          .lean(),
        clientModel.countDocuments(),
      ]);
      const totalPages = Math.ceil(totalClients / limit);

      return {
        clients: clients.map(toPublicClientProfile),
        pagination: {
          page,
          limit,
          totalClients,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: totalPages > 0 && page > 1,
        },
      };
    },
  };
};

export const clientOperations = createClientOperations();

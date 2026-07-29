import ClientModel from "../../../DB/models/client_model.js";
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
} = {}) => {
  return {
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

import bcrypt from "bcryptjs";
import AdminModel from "../../../DB/models/admin_model.js";
import ClientModel from "../../../DB/models/client_model.js";
import FreelancerModel from "../../../DB/models/freelancer_model.js";
import { getSaltRounds } from "../../config/saltRounds.js";
import {
  clientAccountNotFound,
  clientEmailConflict,
  clientPasswordChangeConflict,
  clientProfileChangeConflict,
  clientProfileNotFound,
  incorrectCurrentClientPassword,
  reusedCurrentClientPassword,
} from "./clientErrors.js";
import {
  clientSelfProjection,
  publicClientProfileProjection,
  toClientSelf,
  toPublicClientProfile,
} from "./clientRepresentations.js";
import { clientImageLifecycle } from "./clientImageLifecycle.js";

const publicClientProfileSort = Object.freeze({
  createdAt: -1,
  _id: -1,
});

const normalizeStoredProfileValue = (field, value) => {
  if (typeof value !== "string") return value;

  const normalizedValue = value.trim();

  return field === "email"
    ? normalizedValue.toLowerCase()
    : normalizedValue;
};

const escapeRegularExpression = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const isClientEmailDuplicateKeyError = (error) => {
  return (
    error?.code === 11000 &&
    (Object.hasOwn(error?.keyPattern ?? {}, "email") ||
      Object.hasOwn(error?.keyValue ?? {}, "email"))
  );
};

export const createClientOperations = ({
  adminModel = AdminModel,
  clientModel = ClientModel,
  freelancerModel = FreelancerModel,
  getPasswordSaltRounds = getSaltRounds,
  imageLifecycle = clientImageLifecycle,
  passwordHasher = bcrypt,
} = {}) => {
  const preservePrimaryOutcome = async (cleanup) => {
    try {
      await cleanup();
    } catch {
      // Lifecycle cleanup is best-effort and cannot replace business outcomes.
    }
  };

  return {
    updateProfile: async ({
      clientId,
      updates,
      imageUploadHandle,
      correlationId,
    }) => {
      let ownedStagedHandle = imageUploadHandle;
      let ownedPromotedReference;

      try {
        const storedClient = await clientModel
          .findById(clientId, clientSelfProjection)
          .lean();

        if (!storedClient) {
          throw clientAccountNotFound();
        }

        if (Object.hasOwn(updates, "email")) {
          const emailPattern = new RegExp(
            `^${escapeRegularExpression(updates.email)}$`,
            "i",
          );
          const emailMatches = await Promise.all([
            adminModel.exists({ email: emailPattern }),
            clientModel.exists({
              _id: { $ne: clientId },
              email: emailPattern,
            }),
            freelancerModel.exists({ email: emailPattern }),
          ]);

          if (emailMatches.some(Boolean)) {
            throw clientEmailConflict();
          }
        }

        if (imageUploadHandle !== undefined) {
          ownedStagedHandle = undefined;
          const promotedImage = await imageLifecycle.processAndPromote(
            imageUploadHandle,
          );
          ownedPromotedReference = promotedImage.reference;
          const conditionalFilter = {
            _id: clientId,
            image_url: storedClient.image_url ?? null,
          };
          const imageUpdates = {
            ...updates,
            image_url: promotedImage.reference,
          };
          const updatedClient = await clientModel
            .findOneAndUpdate(
              conditionalFilter,
              { $set: imageUpdates },
              { new: true, projection: clientSelfProjection },
            )
            .lean();

          if (!updatedClient) {
            const clientStillExists = await clientModel.exists({
              _id: clientId,
            });
            if (!clientStillExists) {
              throw clientAccountNotFound();
            }
            throw clientProfileChangeConflict();
          }

          ownedPromotedReference = undefined;
          await preservePrimaryOutcome(() =>
            imageLifecycle.cleanupManagedReference({
              reference: storedClient.image_url,
              retainedReference: promotedImage.reference,
              operation: "replace-client-image",
              correlationId,
            }),
          );

          return toClientSelf(updatedClient);
        }

        const updateIsNoOp = Object.entries(updates).every(
          ([field, value]) => {
            return (
              normalizeStoredProfileValue(field, storedClient[field]) === value
            );
          },
        );

        if (updateIsNoOp) {
          return toClientSelf(storedClient);
        }

        const updatedClient = await clientModel
          .findByIdAndUpdate(
            clientId,
            { $set: updates },
            { new: true, projection: clientSelfProjection },
          )
          .lean();

        if (!updatedClient) {
          throw clientAccountNotFound();
        }

        return toClientSelf(updatedClient);
      } catch (error) {
        if (ownedStagedHandle !== undefined) {
          await preservePrimaryOutcome(() =>
            imageLifecycle.discardStagedUpload(ownedStagedHandle, {
              operation: "discard-unretained-client-image",
              correlationId,
            }),
          );
        }
        if (ownedPromotedReference !== undefined) {
          await preservePrimaryOutcome(() =>
            imageLifecycle.cleanupManagedReference({
              reference: ownedPromotedReference,
              operation: "discard-unretained-client-image",
              correlationId,
            }),
          );
        }

        if (isClientEmailDuplicateKeyError(error)) {
          throw clientEmailConflict();
        }

        throw error;
      }
    },
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

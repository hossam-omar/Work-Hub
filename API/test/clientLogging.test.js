import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRequestContextMiddleware } from "../src/middleware/requestContext.middleware.js";
import {
  createClientsRouter,
  createPublicClientLookupRequestValidator,
} from "../src/modules/clients/clientsRoutes.js";
import {
  createChangeClientPasswordController,
  createClientProfileUpdateErrorHandler,
  createDeleteClientController,
  createGetPublicProfileByIdController,
  createListPublicProfilesController,
  createUpdateClientProfileController,
} from "../src/modules/clients/clientsController.js";
import {
  CLIENT_IMAGE_ERROR_CATEGORIES,
  ClientImageLifecycleError,
  createClientImageLifecycle,
} from "../src/modules/clients/clientImageLifecycle.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

const withServer = async ({ requestId, router }, operation) => {
  const app = express();
  app.use(
    createRequestContextMiddleware({
      generateRequestId: () => requestId,
    }),
  );
  app.use(express.json());
  app.use("/api/v1/clients", router);
  app.use(errorHandler);

  const server = app.listen(0);

  try {
    const address = server.address();
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
};

const createResponse = (locals = {}) => ({
  locals,
  statusCode: undefined,
  body: undefined,
  headersSent: false,
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("Client database failures emit one safe correlated structured record", async () => {
  const requestId = "request-47-database";
  const privatePath = "C:\\private\\database\\client.bson";
  const privateToken = "Bearer private-client-token";
  const databaseError = Object.assign(
    new Error(`MongoDB failed at ${privatePath} using ${privateToken}`),
    { code: "MONGO_QUERY_FAILED" },
  );
  const records = [];
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async () => {
        throw databaseError;
      },
    },
    logger: { error: (record) => records.push(record) },
  });
  const router = createClientsRouter({
    listPublicProfilesHandler: controller,
  });

  await withServer({ requestId, router }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/clients`, {
      headers: { authorization: privateToken },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-request-id"), requestId);
    assert.deepEqual(await response.json(), {
      message: "Internal server error.",
    });
  });

  assert.deepEqual(records, [
    {
      phase: "database",
      operation: "Failed to list public Client Profiles.",
      correlationId: requestId,
      name: "Error",
      code: "MONGO_QUERY_FAILED",
    },
  ]);
  const serializedRecords = JSON.stringify(records);
  assert.equal(serializedRecords.includes(privatePath), false);
  assert.equal(serializedRecords.includes(privateToken), false);
  assert.equal(serializedRecords.includes(databaseError.message), false);
});

test("Client cleanup logs use the response request identifier without changing success", async () => {
  const requestId = "request-47-cleanup";
  const privateToken = "Bearer private-client-token";
  const privatePassword = "Legacy password";
  const reference = `/uploads/client-${"a".repeat(48)}.jpg`;
  const stagingRoot = "C:\\private\\staging";
  const uploadsRoot = "C:\\private\\uploads";
  const records = [];
  const imageLifecycle = createClientImageLifecycle({
    stagingRoot,
    uploadsRoot,
    lstatFn: async () => ({ isFile: () => true }),
    unlinkFn: async (target) => {
      throw Object.assign(
        new Error(
          `EACCES: authorization=private-token password=${privatePassword} at '${target}' request-body.`,
        ),
        { code: "EACCES" },
      );
    },
    logger: { error: (record) => records.push(record) },
  });
  const controller = createDeleteClientController({
    operations: {
      deleteAccount: async ({ correlationId }) => {
        await imageLifecycle.cleanupManagedReference({
          reference,
          operation: "delete-client-profile-image",
          correlationId,
        });
      },
    },
    logger: { error: () => assert.fail("success must not be logged") },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: "507f1f77bcf86cd799439011" };
      return next();
    },
    deleteClientHandler: controller,
  });

  await withServer({ requestId, router }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
      method: "DELETE",
      headers: {
        authorization: privateToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ currentPassword: privatePassword }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), requestId);
    assert.deepEqual(await response.json(), {
      message: "Client account deleted successfully.",
    });
  });

  assert.deepEqual(records, [
    {
      phase: "cleanup",
      operation: "delete-client-profile-image",
      reference,
      code: "EACCES",
      message:
        "EACCES: [redacted] [redacted] [redacted] at '[path]' [redacted].",
      correlationId: requestId,
    },
  ]);
  const serializedRecords = JSON.stringify(records);
  assert.equal(serializedRecords.includes(stagingRoot), false);
  assert.equal(serializedRecords.includes(uploadsRoot), false);
  assert.equal(serializedRecords.includes(privateToken), false);
  assert.equal(serializedRecords.includes(privatePassword), false);
  assert.equal(serializedRecords.includes("request-body"), false);
});

test("every Client database failure path consumes the request correlation identifier", async (t) => {
  const privateMessage =
    "private body token password at C:\\private\\database\\client.bson";
  const cases = [
    {
      name: "public profile lookup",
      operation: "Failed to get public Client Profile.",
      createHandler: (logger, error) =>
        createGetPublicProfileByIdController({
          operations: {
            getPublicProfileById: async () => {
              throw error;
            },
          },
          logger,
        }),
      request: { id: "request-47-lookup" },
      response: () =>
        createResponse({
          publicClientProfileId: "507f1f77bcf86cd799439011",
        }),
    },
    {
      name: "password change",
      operation: "Failed to change Client password.",
      createHandler: (logger, error) =>
        createChangeClientPasswordController({
          operations: {
            changePassword: async () => {
              throw error;
            },
          },
          logger,
        }),
      request: {
        id: "request-47-password",
        user: { _id: "507f1f77bcf86cd799439011" },
      },
      response: () =>
        createResponse({
          clientPasswordChange: {
            currentPassword: "private-current-password",
            newPassword: "private-new-password",
          },
        }),
    },
    {
      name: "profile update",
      operation: "Failed to update Client profile.",
      createHandler: (logger, error) =>
        createUpdateClientProfileController({
          operations: {
            updateProfile: async () => {
              throw error;
            },
          },
          logger,
        }),
      request: {
        id: "request-47-profile",
        user: { _id: "507f1f77bcf86cd799439011" },
      },
      response: () => createResponse({ clientProfileUpdate: { name: "Ada" } }),
    },
    {
      name: "account deletion",
      operation: "Failed to delete Client account.",
      createHandler: (logger, error) =>
        createDeleteClientController({
          operations: {
            deleteAccount: async () => {
              throw error;
            },
          },
          logger,
        }),
      request: {
        id: "request-47-deletion",
        user: { _id: "507f1f77bcf86cd799439011" },
      },
      response: () =>
        createResponse({
          clientDeletion: { currentPassword: "private-password" },
        }),
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const records = [];
      const databaseError = Object.assign(new Error(privateMessage), {
        name: "Unsafe Error Name with private body",
        code: "C:\\private\\database",
      });
      const handler = testCase.createHandler(
        { error: (record) => records.push(record) },
        databaseError,
      );
      const response = testCase.response();

      await handler(testCase.request, response);

      assert.equal(response.statusCode, 500);
      assert.deepEqual(response.body, { message: "Internal server error." });
      assert.deepEqual(records, [
        {
          phase: "database",
          operation: testCase.operation,
          correlationId: testCase.request.id,
          name: "Error",
          code: "UNKNOWN",
        },
      ]);
      const serializedRecords = JSON.stringify(records);
      assert.equal(serializedRecords.includes(privateMessage), false);
      assert.equal(serializedRecords.includes("private body"), false);
      assert.equal(serializedRecords.includes("C:\\private"), false);
    });
  }
});

test("Client storage logs are correlated and logger failures preserve the response", async () => {
  const requestId = "request-47-storage";
  const records = [];
  const handler = createClientProfileUpdateErrorHandler({
    logger: { error: (record) => records.push(record) },
  });
  const response = createResponse();

  handler(
    new ClientImageLifecycleError(
      CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE,
    ),
    { id: requestId },
    response,
    () => assert.fail("the response must be handled"),
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: "Internal server error." });
  assert.deepEqual(records, [
    {
      phase: "storage",
      operation: "Failed to update Client profile.",
      correlationId: requestId,
      name: "ClientImageLifecycleError",
      category: CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE,
    },
  ]);

  const loggerFailureResponse = createResponse();
  const loggerFailureHandler = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async () => {
        throw new Error("database failure remains primary");
      },
    },
    logger: {
      error: () => {
        throw new Error("logger unavailable");
      },
    },
  });

  await loggerFailureHandler(
    { id: "request-47-logger-failure", query: {} },
    loggerFailureResponse,
  );

  assert.equal(loggerFailureResponse.statusCode, 500);
  assert.deepEqual(loggerFailureResponse.body, {
    message: "Internal server error.",
  });
});

test("an asynchronously rejected Client logger cannot replace the database response", async () => {
  const response = createResponse();
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async () => {
        throw new Error("database failure remains primary");
      },
    },
    logger: {
      error: async () => {
        throw new Error("async logger unavailable");
      },
    },
  });

  await controller(
    { id: "request-47-async-logger", query: {} },
    response,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: "Internal server error." });
});

test("unexpected Client lookup validation failures retain request correlation", () => {
  const requestId = "request-47-lookup-validation";
  const records = [];
  const privateError = Object.assign(
    new Error("private request body at C:\\private\\request.json"),
    { code: "CLIENT_PARSE_FAILED" },
  );
  const validator = createPublicClientLookupRequestValidator({
    parseRequest: () => {
      throw privateError;
    },
    logger: { error: (record) => records.push(record) },
  });
  const response = createResponse();

  validator(
    {
      id: requestId,
      params: { id: "507f1f77bcf86cd799439011" },
      query: {},
    },
    response,
    () => assert.fail("the validation failure must be handled"),
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: "Internal server error." });
  assert.deepEqual(records, [
    {
      phase: "request",
      operation: "Failed to validate public Client Profile lookup.",
      correlationId: requestId,
      name: "Error",
      code: "CLIENT_PARSE_FAILED",
    },
  ]);
  assert.equal(JSON.stringify(records).includes(privateError.message), false);
  assert.equal(JSON.stringify(records).includes("C:\\private"), false);
});

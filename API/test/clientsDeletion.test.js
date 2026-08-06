import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import express from "express";
import { createClientsRouter } from "../src/modules/clients/clientsRoutes.js";
import { createDeleteClientController } from "../src/modules/clients/clientsController.js";
import { createClientOperations } from "../src/modules/clients/clientsOperations.js";
import { handleClientDeletionParseError } from "../src/modules/clients/clientRequest.middleware.js";
import { createClientImageLifecycle } from "../src/modules/clients/clientImageLifecycle.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

const authenticatedClientId = "507f1f77bcf86cd799439011";
const validDeletionBody = { currentPassword: "Legacy password" };

const withImageLifecycle = async (operation, overrides = {}) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "work-hub-client-deletion-"),
  );
  const stagingRoot = path.join(root, "private-staging");
  const uploadsRoot = path.join(root, "uploads");
  await Promise.all([
    mkdir(stagingRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
  const imageLifecycle = createClientImageLifecycle({
    stagingRoot,
    uploadsRoot,
    ...overrides,
  });

  try {
    await operation({ imageLifecycle, root, uploadsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const withTestServer = async (router, operation) => {
  const app = express();
  app.use(express.json());
  app.use(handleClientDeletionParseError);
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

const requestDeletion = (
  baseUrl,
  {
    body = validDeletionBody,
    contentType = "application/json",
    method = "DELETE",
    path = "/api/v1/clients/me",
    rawBody,
  } = {},
) => {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": contentType },
    body:
      rawBody ??
      (contentType === "application/json" ? JSON.stringify(body) : body),
  });
};

test("Client self-deletion authenticates and targets only the token-derived Client", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      events.push("auth");
      req.user = { _id: authenticatedClientId };
      return next();
    },
    clientDeletionRequestHandler: (req, res, next) => {
      events.push("request");
      res.locals.clientDeletion = req.body;
      return next();
    },
    deleteClientHandler: (req, res) => {
      events.push({
        step: "handler",
        clientId: req.user._id,
        input: res.locals.clientDeletion,
      });
      return res.status(200).json({ accepted: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
  });

  assert.deepEqual(events, [
    "auth",
    "request",
    {
      step: "handler",
      clientId: authenticatedClientId,
      input: validDeletionBody,
    },
  ]);
});

test("Client self-deletion rejects unsupported media after authentication", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => {
      events.push("auth");
      return next();
    },
    deleteClientHandler: (_req, res) => {
      events.push("handler");
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl, {
      body: "not-json",
      contentType: "text/plain",
    });

    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      message: "Unsupported media type.",
    });
  });

  assert.deepEqual(events, ["auth"]);
});

test("Client self-deletion rejects every invalid request structure exactly", async () => {
  let handlerCalls = 0;
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    deleteClientHandler: (_req, res) => {
      handlerCalls += 1;
      return res.status(200).json({ unexpected: true });
    },
  });
  const cases = [
    { name: "missing field", body: {} },
    {
      name: "extra field",
      body: { ...validDeletionBody, role: "admin" },
    },
    {
      name: "Client identity",
      body: { ...validDeletionBody, clientId: authenticatedClientId },
    },
    {
      name: "generic identity",
      body: { ...validDeletionBody, id: authenticatedClientId },
    },
    {
      name: "persistence identity",
      body: { ...validDeletionBody, _id: authenticatedClientId },
    },
    {
      name: "query identity",
      path: `/api/v1/clients/me?clientId=${authenticatedClientId}`,
      body: validDeletionBody,
    },
    { name: "non-string password", body: { currentPassword: 123 } },
    { name: "array body", body: [validDeletionBody] },
    { name: "string body", body: "submitted-current-password" },
    { name: "numeric body", body: 123 },
    { name: "null body", body: null },
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await requestDeletion(baseUrl, testCase);
      const responseBody = await response.json();

      assert.equal(response.status, 400, testCase.name);
      assert.deepEqual(
        responseBody,
        { message: "Invalid request." },
        testCase.name,
      );
      assert.equal(
        JSON.stringify(responseBody).includes(authenticatedClientId),
        false,
        testCase.name,
      );
      assert.equal(
        JSON.stringify(responseBody).includes("submitted-current-password"),
        false,
        testCase.name,
      );
    }
  });

  assert.equal(handlerCalls, 0);
});

test("Client self-deletion returns the exact success response from the token-derived operation", async () => {
  const calls = [];
  const controller = createDeleteClientController({
    operations: {
      deleteAccount: async (input) => {
        calls.push(input);
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      req.id = "request-45";
      return next();
    },
    deleteClientHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Client account deleted successfully.",
    });
  });

  assert.deepEqual(calls, [
    {
      clientId: authenticatedClientId,
      currentPassword: validDeletionBody.currentPassword,
      correlationId: "request-45",
    },
  ]);
});

test("Client Operations verifies, guards, and conditionally deletes using the observed password", async () => {
  const observedPasswordHash = "observed-password-hash";
  const calls = {
    findById: [],
    compare: [],
    guard: [],
    deleteOne: [],
    exists: [],
  };
  const clientModel = {
    findById(id, projection) {
      calls.findById.push({ id, projection });
      return {
        lean: async () => ({
          password: observedPasswordHash,
          image_url: null,
          coverImage_url: null,
        }),
      };
    },
    async deleteOne(filter) {
      calls.deleteOne.push(filter);
      return { acknowledged: true, deletedCount: 1 };
    },
    async exists(filter) {
      calls.exists.push(filter);
      return { _id: authenticatedClientId };
    },
  };
  const operations = createClientOperations({
    clientModel,
    deletionGuard: {
      isBlocked: async (id) => {
        calls.guard.push(id);
        return false;
      },
    },
    imageLifecycle: { cleanupManagedReference: async () => undefined },
    passwordHasher: {
      compare: async (value, hash) => {
        calls.compare.push({ value, hash });
        return true;
      },
    },
  });

  await operations.deleteAccount({
    clientId: authenticatedClientId,
    currentPassword: validDeletionBody.currentPassword,
  });

  assert.deepEqual(calls, {
    findById: [
      {
        id: authenticatedClientId,
        projection: {
          password: 1,
          image_url: 1,
          coverImage_url: 1,
        },
      },
    ],
    compare: [
      {
        value: validDeletionBody.currentPassword,
        hash: observedPasswordHash,
      },
    ],
    guard: [authenticatedClientId],
    deleteOne: [
      {
        _id: authenticatedClientId,
        password: observedPasswordHash,
      },
    ],
    exists: [],
  });
});

test("a blocked deletion returns the non-disclosing dependency conflict", async () => {
  const calls = { deleteOne: 0, cleanup: 0 };
  const controller = createDeleteClientController({
    operations: createClientOperations({
      clientModel: {
        findById() {
          return {
            lean: async () => ({
              password: "observed-password-hash",
              image_url: "/uploads/private-profile.jpg",
              coverImage_url: "/uploads/private-cover.jpg",
            }),
          };
        },
        async deleteOne() {
          calls.deleteOne += 1;
          return { deletedCount: 1 };
        },
      },
      deletionGuard: { isBlocked: async () => true },
      imageLifecycle: {
        cleanupManagedReference: async () => {
          calls.cleanup += 1;
        },
      },
      passwordHasher: { compare: async () => true },
    }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    deleteClientHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);
    const responseBody = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(responseBody, {
      message: "Client account cannot be deleted while related records exist.",
    });
    const serialized = JSON.stringify(responseBody);
    assert.equal(serialized.includes("Community"), false);
    assert.equal(serialized.includes("Order"), false);
    assert.equal(serialized.includes(authenticatedClientId), false);
  });

  assert.deepEqual(calls, { deleteOne: 0, cleanup: 0 });
});

test("a conditional deletion loser reports an account-change conflict without cleanup", async () => {
  const calls = { exists: [], cleanup: 0 };
  const controller = createDeleteClientController({
    operations: createClientOperations({
      clientModel: {
        findById() {
          return {
            lean: async () => ({
              password: "observed-password-hash",
              image_url: `/uploads/client-${"a".repeat(48)}.jpg`,
              coverImage_url: null,
            }),
          };
        },
        async deleteOne() {
          return { acknowledged: true, deletedCount: 0 };
        },
        async exists(filter) {
          calls.exists.push(filter);
          return { _id: authenticatedClientId };
        },
      },
      deletionGuard: { isBlocked: async () => false },
      imageLifecycle: {
        cleanupManagedReference: async () => {
          calls.cleanup += 1;
        },
      },
      passwordHasher: { compare: async () => true },
    }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    deleteClientHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      message: "Client account changed during deletion. Please sign in again.",
    });
  });

  assert.deepEqual(calls.exists, [{ _id: authenticatedClientId }]);
  assert.equal(calls.cleanup, 0);
});

test("an incorrect deletion password stops before the guard, database, and cleanup", async () => {
  const calls = { guard: 0, deleteOne: 0, cleanup: 0 };
  const operations = createClientOperations({
    clientModel: {
      findById() {
        return {
          lean: async () => ({
            password: "observed-password-hash",
            image_url: `/uploads/client-${"b".repeat(48)}.jpg`,
            coverImage_url: null,
          }),
        };
      },
      async deleteOne() {
        calls.deleteOne += 1;
        return { deletedCount: 1 };
      },
    },
    deletionGuard: {
      isBlocked: async () => {
        calls.guard += 1;
        return false;
      },
    },
    imageLifecycle: {
      cleanupManagedReference: async () => {
        calls.cleanup += 1;
      },
    },
    passwordHasher: { compare: async () => false },
  });

  await assert.rejects(
    () =>
      operations.deleteAccount({
        clientId: authenticatedClientId,
        currentPassword: validDeletionBody.currentPassword,
      }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Current password is incorrect.");
      return true;
    },
  );

  assert.deepEqual(calls, { guard: 0, deleteOne: 0, cleanup: 0 });
});

test("an incorrect deletion password returns the exact safe HTTP response", async () => {
  const controller = createDeleteClientController({
    operations: createClientOperations({
      clientModel: {
        findById() {
          return {
            lean: async () => ({
              password: "observed-password-hash",
              image_url: null,
              coverImage_url: null,
            }),
          };
        },
      },
      deletionGuard: {
        isBlocked: async () => {
          throw new Error("guard must not run");
        },
      },
      imageLifecycle: {
        cleanupManagedReference: async () => {
          throw new Error("cleanup must not run");
        },
      },
      passwordHasher: { compare: async () => false },
    }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    deleteClientHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "Current password is incorrect.",
    });
  });
});

test("a Client missing before or during deletion returns the exact not-found result", async (t) => {
  for (const testCase of [
    { name: "missing before verification", storedClient: null },
    {
      name: "missing after conditional delete",
      storedClient: {
        password: "observed-password-hash",
        image_url: null,
        coverImage_url: null,
      },
    },
  ]) {
    await t.test(testCase.name, async () => {
      let cleanupCalls = 0;
      const operations = createClientOperations({
        clientModel: {
          findById() {
            return { lean: async () => testCase.storedClient };
          },
          async deleteOne() {
            return { deletedCount: 0 };
          },
          async exists() {
            return null;
          },
        },
        deletionGuard: { isBlocked: async () => false },
        imageLifecycle: {
          cleanupManagedReference: async () => {
            cleanupCalls += 1;
          },
        },
        passwordHasher: { compare: async () => true },
      });

      await assert.rejects(
        () =>
          operations.deleteAccount({
            clientId: authenticatedClientId,
            currentPassword: validDeletionBody.currentPassword,
          }),
        (error) => {
          assert.equal(error.statusCode, 404);
          assert.equal(error.message, "Client account not found.");
          return true;
        },
      );
      assert.equal(cleanupCalls, 0);
    });
  }
});

test("guard and database failures return a generic response with safe logs and no cleanup", async (t) => {
  for (const failurePoint of ["guard", "database"]) {
    await t.test(failurePoint, async () => {
      const privateError = Object.assign(
        new Error(
          `private ${failurePoint} details ${validDeletionBody.currentPassword}`,
        ),
        { code: `PRIVATE_${failurePoint.toUpperCase()}_FAILURE` },
      );
      const logs = [];
      let cleanupCalls = 0;
      const controller = createDeleteClientController({
        operations: createClientOperations({
          clientModel: {
            findById() {
              return {
                lean: async () => ({
                  password: "observed-password-hash",
                  image_url: `/uploads/client-${"c".repeat(48)}.jpg`,
                  coverImage_url: null,
                }),
              };
            },
            async deleteOne() {
              if (failurePoint === "database") throw privateError;
              return { deletedCount: 1 };
            },
          },
          deletionGuard: {
            isBlocked: async () => {
              if (failurePoint === "guard") throw privateError;
              return false;
            },
          },
          imageLifecycle: {
            cleanupManagedReference: async () => {
              cleanupCalls += 1;
            },
          },
          passwordHasher: { compare: async () => true },
        }),
        logger: { error: (...values) => logs.push(values) },
      });
      const router = createClientsRouter({
        clientAuthHandler: (req, _res, next) => {
          req.user = { _id: authenticatedClientId };
          return next();
        },
        deleteClientHandler: controller,
      });

      await withTestServer(router, async (baseUrl) => {
        const response = await requestDeletion(baseUrl);

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          message: "Internal server error.",
        });
      });

      assert.equal(cleanupCalls, 0);
      assert.deepEqual(logs, [
        [
          "Failed to delete Client account.",
          { name: "Error", code: privateError.code },
        ],
      ]);
      const serializedLogs = JSON.stringify(logs);
      assert.equal(serializedLogs.includes(privateError.message), false);
      assert.equal(
        serializedLogs.includes(validDeletionBody.currentPassword),
        false,
      );
    });
  }
});

test("successful database deletion precedes profile and cover image cleanup", async () => {
  const profileReference = `/uploads/client-${"d".repeat(48)}.jpg`;
  const coverReference = `/uploads/client-${"e".repeat(48)}.png`;
  const events = [];
  let databaseSucceeded = false;
  const operations = createClientOperations({
    clientModel: {
      findById() {
        return {
          lean: async () => ({
            password: "observed-password-hash",
            image_url: profileReference,
            coverImage_url: coverReference,
          }),
        };
      },
      async deleteOne() {
        databaseSucceeded = true;
        events.push("database");
        return { deletedCount: 1 };
      },
    },
    deletionGuard: { isBlocked: async () => false },
    imageLifecycle: {
      cleanupManagedReference: async (input) => {
        assert.equal(databaseSucceeded, true);
        events.push(input);
      },
    },
    passwordHasher: { compare: async () => true },
  });

  await operations.deleteAccount({
    clientId: authenticatedClientId,
    currentPassword: validDeletionBody.currentPassword,
    correlationId: "request-45-cleanup",
  });

  assert.equal(events[0], "database");
  assert.deepEqual(events.slice(1), [
    {
      reference: profileReference,
      operation: "delete-client-profile-image",
      correlationId: "request-45-cleanup",
    },
    {
      reference: coverReference,
      operation: "delete-client-cover-image",
      correlationId: "request-45-cleanup",
    },
  ]);
});

test("successful Client deletion removes both locally managed profile images", async () => {
  let deletionSucceeded = false;
  let unlinkCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, uploadsRoot }) => {
      const profileReference = `/uploads/client-${"f".repeat(48)}.jpg`;
      const coverReference = `/uploads/client-${"1".repeat(48)}.webp`;
      await Promise.all([
        writeFile(
          path.join(uploadsRoot, path.basename(profileReference)),
          "profile",
        ),
        writeFile(
          path.join(uploadsRoot, path.basename(coverReference)),
          "cover",
        ),
      ]);
      const operations = createClientOperations({
        clientModel: {
          findById() {
            return {
              lean: async () => ({
                password: "observed-password-hash",
                image_url: profileReference,
                coverImage_url: coverReference,
              }),
            };
          },
          async deleteOne() {
            deletionSucceeded = true;
            return { deletedCount: 1 };
          },
        },
        deletionGuard: { isBlocked: async () => false },
        imageLifecycle,
        passwordHasher: { compare: async () => true },
      });

      await operations.deleteAccount({
        clientId: authenticatedClientId,
        currentPassword: validDeletionBody.currentPassword,
      });

      assert.equal(unlinkCalls, 2);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      unlinkFn: async (target) => {
        assert.equal(deletionSucceeded, true);
        unlinkCalls += 1;
        await unlink(target);
      },
    },
  );
});

test("unsafe, external, default, absent, and missing deletion images are not unlink targets", async (t) => {
  const cases = [
    {
      name: "external and default",
      profile: "https://legacy.example/profile.jpg",
      cover: "/uploads/default.png",
    },
    {
      name: "unsafe and absent",
      profile: "/uploads/../outside.jpg",
      cover: null,
    },
    {
      name: "missing managed files",
      profile: `/uploads/client-${"2".repeat(48)}.jpg`,
      cover: `/uploads/client-${"3".repeat(48)}.png`,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let unlinkCalls = 0;
      await withImageLifecycle(
        async ({ imageLifecycle, uploadsRoot }) => {
          const operations = createClientOperations({
            clientModel: {
              findById() {
                return {
                  lean: async () => ({
                    password: "observed-password-hash",
                    image_url: testCase.profile,
                    coverImage_url: testCase.cover,
                  }),
                };
              },
              async deleteOne() {
                return { deletedCount: 1 };
              },
            },
            deletionGuard: { isBlocked: async () => false },
            imageLifecycle,
            passwordHasher: { compare: async () => true },
          });

          await operations.deleteAccount({
            clientId: authenticatedClientId,
            currentPassword: validDeletionBody.currentPassword,
          });

          assert.equal(unlinkCalls, 0);
          assert.deepEqual(await readdir(uploadsRoot), []);
        },
        {
          unlinkFn: async () => {
            unlinkCalls += 1;
          },
        },
      );
    });
  }
});

test("image cleanup failures preserve deletion success and emit only safe lifecycle logs", async () => {
  const cleanupEvents = [];
  let unlinkCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, root, uploadsRoot }) => {
      const profileReference = `/uploads/client-${"4".repeat(48)}.jpg`;
      const coverReference = `/uploads/client-${"5".repeat(48)}.png`;
      await Promise.all([
        writeFile(
          path.join(uploadsRoot, path.basename(profileReference)),
          "profile",
        ),
        writeFile(
          path.join(uploadsRoot, path.basename(coverReference)),
          "cover",
        ),
      ]);
      const controllerLogs = [];
      const controller = createDeleteClientController({
        operations: createClientOperations({
          clientModel: {
            findById() {
              return {
                lean: async () => ({
                  password: "observed-password-hash",
                  image_url: profileReference,
                  coverImage_url: coverReference,
                }),
              };
            },
            async deleteOne() {
              return { deletedCount: 1 };
            },
          },
          deletionGuard: { isBlocked: async () => false },
          imageLifecycle,
          passwordHasher: { compare: async () => true },
        }),
        logger: { error: (...values) => controllerLogs.push(values) },
      });
      const router = createClientsRouter({
        clientAuthHandler: (req, _res, next) => {
          req.user = { _id: authenticatedClientId };
          req.id = "request-45-cleanup-failure";
          return next();
        },
        deleteClientHandler: controller,
      });

      await withTestServer(router, async (baseUrl) => {
        const response = await requestDeletion(baseUrl);

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          message: "Client account deleted successfully.",
        });
      });

      assert.equal(unlinkCalls, 2);
      assert.deepEqual(controllerLogs, []);
      assert.deepEqual(
        cleanupEvents.map((event) => event.operation).sort(),
        ["delete-client-cover-image", "delete-client-profile-image"],
      );
      for (const event of cleanupEvents) {
        assert.equal(event.phase, "cleanup");
        assert.equal(event.code, "EACCES");
        assert.equal(event.correlationId, "request-45-cleanup-failure");
      }
      const serializedEvents = JSON.stringify(cleanupEvents);
      assert.equal(serializedEvents.includes(root), false);
      assert.equal(serializedEvents.includes("private-token"), false);
      assert.deepEqual((await readdir(uploadsRoot)).sort(), [
        path.basename(coverReference),
        path.basename(profileReference),
      ].sort());
    },
    {
      logger: { error: (event) => cleanupEvents.push(event) },
      unlinkFn: async (target) => {
        unlinkCalls += 1;
        throw Object.assign(
          new Error(
            `EACCES private-token: unable to unlink '${target}'.`,
          ),
          { code: "EACCES" },
        );
      },
    },
  );
});

test("Client self-deletion rejects malformed JSON without leaking the password", async () => {
  const submittedPassword = "malformed-current-password";
  let handlerCalls = 0;
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    deleteClientHandler: (_req, res) => {
      handlerCalls += 1;
      return res.status(204).end();
    },
  });

  await withTestServer(router, async (baseUrl) => {
    for (const pathValue of [
      "/api/v1/clients/me",
      "/api/v1/clients/me/",
      "/api/v1/clients/ME",
    ]) {
      const response = await requestDeletion(baseUrl, {
        path: pathValue,
        rawBody: `{"currentPassword":"${submittedPassword}"`,
      });
      const responseBody = await response.json();

      assert.equal(response.status, 400, pathValue);
      assert.deepEqual(
        responseBody,
        { message: "Invalid request." },
        pathValue,
      );
      assert.equal(
        JSON.stringify(responseBody).includes(submittedPassword),
        false,
        pathValue,
      );
    }

    const unrelatedResponse = await requestDeletion(baseUrl, {
      path: "/api/v1/clients/not-the-deletion-route",
      rawBody: "{",
    });
    const unrelatedBody = await unrelatedResponse.json();

    assert.equal(unrelatedResponse.status, 400);
    assert.equal(unrelatedBody.success, false);
  });

  assert.equal(handlerCalls, 0);
});

test("Client self-deletion requires the shared Client authentication middleware", async () => {
  const events = [];
  const router = createClientsRouter({
    clientDeletionRequestHandler: (_req, _res, next) => {
      events.push("request");
      return next();
    },
    deleteClientHandler: (_req, res) => {
      events.push("handler");
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestDeletion(baseUrl);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      message: "Invalid header token",
    });
  });

  assert.deepEqual(events, []);
});

test("legacy and ID-appended Client deletion routes are absent", async () => {
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    clientDeletionRequestHandler: (_req, _res, next) => next(),
    deleteClientHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const legacyResponse = await requestDeletion(baseUrl, {
      path: `/api/v1/clients/deleteClient/${authenticatedClientId}`,
    });
    const idAppendedResponse = await requestDeletion(baseUrl, {
      path: `/api/v1/clients/me/${authenticatedClientId}`,
    });

    assert.equal(legacyResponse.status, 404);
    assert.equal(idAppendedResponse.status, 404);
  });
});

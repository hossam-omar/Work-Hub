import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClientsRouter } from "../src/modules/clients/clientsRoutes.js";
import { createUpdateClientProfileController } from "../src/modules/clients/clientsController.js";
import { createClientOperations } from "../src/modules/clients/clientsOperations.js";
import { handleClientProfileUpdateParseError } from "../src/modules/clients/clientRequest.middleware.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

const authenticatedClientId = "507f1f77bcf86cd799439011";

const withTestServer = async (router, operation) => {
  const app = express();
  app.use(express.json());
  app.use(handleClientProfileUpdateParseError);
  app.use("/api/v1/clients", router);
  app.use(errorHandler);

  const server = app.listen(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await operation(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
};

const requestProfileUpdate = (
  baseUrl,
  {
    body = { name: "  Example Client  " },
    contentType = "application/json",
    path = "/api/v1/clients/me",
    rawBody,
  } = {},
) => {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": contentType },
    body:
      rawBody ??
      (contentType === "application/json" ? JSON.stringify(body) : body),
  });
};

test("Client profile update authenticates and normalizes supplied name", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      events.push("auth");
      req.user = { _id: authenticatedClientId };
      return next();
    },
    updateProfileHandler: (req, res) => {
      events.push({
        step: "handler",
        clientId: req.user._id,
        updates: res.locals.clientProfileUpdate,
      });
      return res.status(200).json({ accepted: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
  });

  assert.deepEqual(events, [
    "auth",
    {
      step: "handler",
      clientId: authenticatedClientId,
      updates: { name: "Example Client" },
    },
  ]);
});

test("Client profile update normalizes email and returns the exact Client self response", async () => {
  const calls = [];
  const clientRepresentation = {
    id: authenticatedClientId,
    name: "Example Client",
    email: "updated@example.technology",
    imageUrl: "/uploads/client.webp",
    coverImageUrl: null,
    country: "Egypt",
  };
  const controller = createUpdateClientProfileController({
    operations: {
      updateProfile: async (input) => {
        calls.push(input);
        return clientRepresentation;
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    updateProfileHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl, {
      body: { email: "  Updated@Example.TECHNOLOGY  " },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Client profile updated successfully.",
      client: clientRepresentation,
    });
  });

  assert.deepEqual(calls, [
    {
      clientId: authenticatedClientId,
      updates: { email: "updated@example.technology" },
    },
  ]);
});

test("Client profile update rejects invalid request structures exactly", async () => {
  let handlerCalls = 0;
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    updateProfileHandler: (_req, res) => {
      handlerCalls += 1;
      return res.status(204).end();
    },
  });
  const cases = [
    { name: "empty body", body: {} },
    { name: "array body", body: [{ name: "Example Client" }] },
    { name: "unknown field", body: { role: "admin" } },
    {
      name: "extra field",
      body: { name: "Example Client", activityStatus: "online" },
    },
    { name: "client identity", body: { clientId: authenticatedClientId } },
    { name: "generic identity", body: { id: authenticatedClientId } },
    { name: "persistence identity", body: { _id: authenticatedClientId } },
    { name: "image reference", body: { image_url: "client.webp" } },
    { name: "cover image reference", body: { coverImage_url: "cover.webp" } },
    { name: "country", body: { country: "Egypt" } },
    { name: "password", body: { password: "Password1!" } },
    {
      name: "query parameter",
      path: `/api/v1/clients/me?clientId=${authenticatedClientId}`,
      body: { name: "Example Client" },
    },
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await requestProfileUpdate(baseUrl, testCase);

      assert.equal(response.status, 400, testCase.name);
      assert.deepEqual(
        await response.json(),
        { message: "Invalid request." },
        testCase.name,
      );
    }
  });

  assert.equal(handlerCalls, 0);
});

test("Client profile update aggregates fixed name and email validation errors", async () => {
  const invalidEmail = "submitted-invalid-email-value";
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    updateProfileHandler: (_req, res) => res.status(204).end(),
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl, {
      body: { name: " x ", email: invalidEmail },
    });
    const responseBody = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, {
      message: "Validation failed.",
      errors: {
        name: "Name must be between 2 and 100 characters.",
        email: "Email must be a valid email address.",
      },
    });
    assert.equal(JSON.stringify(responseBody).includes(invalidEmail), false);
  });
});

test("Client profile update accepts Unicode names and exact value boundaries", async () => {
  const acceptedUpdates = [];
  const maximumEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    updateProfileHandler: (_req, res) => {
      acceptedUpdates.push(res.locals.clientProfileUpdate);
      return res.status(204).end();
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const cases = [
      { name: "李雷" },
      { name: "م".repeat(100) },
      { email: "Person@Example.TECHNOLOGY" },
      { email: maximumEmail },
      { name: "  André O'Connor  ", email: "  Person@Example.DEV  " },
    ];

    for (const body of cases) {
      const response = await requestProfileUpdate(baseUrl, { body });

      assert.equal(response.status, 204, JSON.stringify(body));
    }
  });

  assert.deepEqual(acceptedUpdates, [
    { name: "李雷" },
    { name: "م".repeat(100) },
    { email: "person@example.technology" },
    { email: maximumEmail },
    { name: "André O'Connor", email: "person@example.dev" },
  ]);
});

test("Client profile update rejects invalid value types and boundaries", async () => {
  const maximumEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    updateProfileHandler: (_req, res) => res.status(204).end(),
  });
  const cases = [
    {
      name: "one-character name",
      body: { name: "x" },
      errors: { name: "Name must be between 2 and 100 characters." },
    },
    {
      name: "name above maximum",
      body: { name: "a".repeat(101) },
      errors: { name: "Name must be between 2 and 100 characters." },
    },
    {
      name: "non-string name",
      body: { name: 123 },
      errors: { name: "Name must be between 2 and 100 characters." },
    },
    {
      name: "email above maximum",
      body: { email: `${maximumEmail}x` },
      errors: { email: "Email must be a valid email address." },
    },
    {
      name: "non-string email",
      body: { email: ["client@example.com"] },
      errors: { email: "Email must be a valid email address." },
    },
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await requestProfileUpdate(baseUrl, {
        body: testCase.body,
      });

      assert.equal(response.status, 400, testCase.name);
      assert.deepEqual(
        await response.json(),
        { message: "Validation failed.", errors: testCase.errors },
        testCase.name,
      );
    }
  });
});

test("Client profile update handles parser failures without leaking inputs or changing unrelated errors", async () => {
  const submittedSecret = "submitted-profile-value";
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    updateProfileHandler: (_req, res) => res.status(204).end(),
  });

  await withTestServer(router, async (baseUrl) => {
    for (const path of [
      "/api/v1/clients/me",
      "/api/v1/clients/me/",
      "/api/v1/clients/ME",
    ]) {
      const malformedResponse = await requestProfileUpdate(baseUrl, {
        path,
        rawBody: `{"name":"${submittedSecret}"`,
      });
      const malformedBody = await malformedResponse.json();

      assert.equal(malformedResponse.status, 400, path);
      assert.deepEqual(
        malformedBody,
        { message: "Invalid request." },
        path,
      );
      assert.equal(
        JSON.stringify(malformedBody).includes(submittedSecret),
        false,
        path,
      );
    }

    const primitiveResponse = await requestProfileUpdate(baseUrl, {
      body: submittedSecret,
    });
    const primitiveBody = await primitiveResponse.json();

    assert.equal(primitiveResponse.status, 400);
    assert.deepEqual(primitiveBody, { message: "Invalid request." });
    assert.equal(JSON.stringify(primitiveBody).includes(submittedSecret), false);

    const unrelatedResponse = await requestProfileUpdate(baseUrl, {
      path: "/api/v1/clients/not-the-profile-route",
      rawBody: "{",
    });
    const unrelatedBody = await unrelatedResponse.json();

    assert.equal(unrelatedResponse.status, 400);
    assert.equal(unrelatedBody.success, false);
  });
});

test("Client Operations updates only the supplied name and returns the exact self projection", async () => {
  const projection = {
    _id: 1,
    name: 1,
    email: 1,
    image_url: 1,
    coverImage_url: 1,
    country: 1,
  };
  const calls = { findById: [], findByIdAndUpdate: [] };
  const storedClient = {
    _id: authenticatedClientId,
    name: "Existing Client",
    email: "client@example.com",
    image_url: "uploads/client.webp",
    coverImage_url: "C:\\private\\cover.webp",
    country: "Egypt",
    password: "private-password-hash",
    token: "private-token",
    role: "client",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  const persistedClient = { ...storedClient, name: "Updated Client" };
  const clientModel = {
    findById(id, selectedProjection) {
      calls.findById.push({ id, projection: selectedProjection });
      return { lean: async () => storedClient };
    },
    findByIdAndUpdate(id, update, options) {
      calls.findByIdAndUpdate.push({ id, update, options });
      return { lean: async () => persistedClient };
    },
  };
  const operations = createClientOperations({
    clientModel,
    adminModel: { exists: async () => false },
    freelancerModel: { exists: async () => false },
  });

  const result = await operations.updateProfile({
    clientId: authenticatedClientId,
    updates: { name: "Updated Client" },
  });

  assert.deepEqual(calls.findById, [
    { id: authenticatedClientId, projection },
  ]);
  assert.deepEqual(calls.findByIdAndUpdate, [
    {
      id: authenticatedClientId,
      update: { $set: { name: "Updated Client" } },
      options: { new: true, projection },
    },
  ]);
  assert.deepEqual(result, {
    id: authenticatedClientId,
    name: "Updated Client",
    email: "client@example.com",
    imageUrl: "/uploads/client.webp",
    coverImageUrl: null,
    country: "Egypt",
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("Client Operations skips a fresh normalized no-op and preserves updatedAt", async () => {
  let updateCalls = 0;
  const storedClient = {
    _id: authenticatedClientId,
    name: "Existing Client",
    email: "client@example.com",
    image_url: null,
    coverImage_url: null,
    country: "Egypt",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  const clientModel = {
    findById() {
      return { lean: async () => storedClient };
    },
    findByIdAndUpdate() {
      updateCalls += 1;
      throw new Error("no-op must not write");
    },
  };
  const operations = createClientOperations({
    clientModel,
    adminModel: { exists: async () => false },
    freelancerModel: { exists: async () => false },
  });

  const result = await operations.updateProfile({
    clientId: authenticatedClientId,
    updates: { name: "Existing Client" },
  });

  assert.equal(updateCalls, 0);
  assert.equal(storedClient.updatedAt, "2026-08-03T00:00:00.000Z");
  assert.deepEqual(result, {
    id: authenticatedClientId,
    name: "Existing Client",
    email: "client@example.com",
    imageUrl: null,
    coverImageUrl: null,
    country: "Egypt",
  });
});

test("Client Operations rejects legacy-case email collisions across every account role", async (t) => {
  for (const conflictingRole of ["admin", "client", "freelancer"]) {
    await t.test(conflictingRole, async () => {
      const calls = { admin: [], client: [], freelancer: [], updates: 0 };
      const createExists = (role) => async (filter) => {
        calls[role].push(filter);
        return role === conflictingRole
          ? { _id: `conflicting-${role}` }
          : null;
      };
      const clientModel = {
        findById() {
          return {
            lean: async () => ({
              _id: authenticatedClientId,
              name: "Existing Client",
              email: "current@example.com",
              image_url: null,
              coverImage_url: null,
              country: "Egypt",
            }),
          };
        },
        exists: createExists("client"),
        findByIdAndUpdate() {
          calls.updates += 1;
          return { lean: async () => null };
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: createExists("admin") },
        clientModel,
        freelancerModel: { exists: createExists("freelancer") },
      });

      await assert.rejects(
        () =>
          operations.updateProfile({
            clientId: authenticatedClientId,
            updates: {
              name: "Updated Client",
              email: "taken.email@example.com",
            },
          }),
        (error) => {
          assert.equal(error.statusCode, 409);
          assert.equal(error.message, "Email is already in use.");
          return true;
        },
      );

      assert.equal(calls.updates, 0);
      assert.equal(calls.admin.length, 1);
      assert.equal(calls.client.length, 1);
      assert.equal(calls.freelancer.length, 1);

      for (const role of ["admin", "client", "freelancer"]) {
        const emailPattern = calls[role][0].email;
        assert.ok(emailPattern instanceof RegExp, role);
        assert.equal(emailPattern.test("Taken.Email@Example.COM"), true, role);
      }

      assert.deepEqual(calls.client[0]._id, { $ne: authenticatedClientId });
    });
  }
});

test("Client Operations maps only Client email duplicate-key failures", async (t) => {
  const createOperations = (writeError) => {
    const clientModel = {
      findById() {
        return {
          lean: async () => ({
            _id: authenticatedClientId,
            name: "Existing Client",
            email: "current@example.com",
            image_url: null,
            coverImage_url: null,
            country: "Egypt",
          }),
        };
      },
      exists: async () => false,
      findByIdAndUpdate() {
        return {
          lean: async () => {
            throw writeError;
          },
        };
      },
    };

    return createClientOperations({
      adminModel: { exists: async () => false },
      clientModel,
      freelancerModel: { exists: async () => false },
    });
  };

  await t.test("email duplicate", async () => {
    const error = new Error("private duplicate email details");
    error.code = 11000;
    error.keyPattern = { email: 1 };
    const operations = createOperations(error);

    await assert.rejects(
      () =>
        operations.updateProfile({
          clientId: authenticatedClientId,
          updates: { email: "updated@example.com" },
        }),
      (mappedError) => {
        assert.equal(mappedError.statusCode, 409);
        assert.equal(mappedError.message, "Email is already in use.");
        return true;
      },
    );
  });

  await t.test("unrelated duplicate", async () => {
    const error = new Error("private unrelated duplicate details");
    error.code = 11000;
    error.keyPattern = { ordersCount: 1 };
    const operations = createOperations(error);

    await assert.rejects(
      () =>
        operations.updateProfile({
          clientId: authenticatedClientId,
          updates: { email: "updated@example.com" },
        }),
      (receivedError) => {
        assert.equal(receivedError, error);
        return true;
      },
    );
  });
});

test("Client Operations allows the authenticated Client's normalized current email as a no-op", async () => {
  const calls = { admin: [], client: [], freelancer: [], updates: 0 };
  const storedClient = {
    _id: authenticatedClientId,
    name: "Existing Client",
    email: "Current.Email@Example.COM",
    image_url: null,
    coverImage_url: null,
    country: "Egypt",
  };
  const clientModel = {
    findById() {
      return { lean: async () => storedClient };
    },
    exists: async (filter) => {
      calls.client.push(filter);
      return false;
    },
    findByIdAndUpdate() {
      calls.updates += 1;
      throw new Error("own-email no-op must not write");
    },
  };
  const operations = createClientOperations({
    adminModel: {
      exists: async (filter) => {
        calls.admin.push(filter);
        return false;
      },
    },
    clientModel,
    freelancerModel: {
      exists: async (filter) => {
        calls.freelancer.push(filter);
        return false;
      },
    },
  });

  const result = await operations.updateProfile({
    clientId: authenticatedClientId,
    updates: { email: "current.email@example.com" },
  });

  assert.equal(calls.updates, 0);
  assert.equal(calls.admin.length, 1);
  assert.equal(calls.client.length, 1);
  assert.equal(calls.freelancer.length, 1);
  assert.deepEqual(calls.client[0]._id, { $ne: authenticatedClientId });
  assert.equal(result.email, "Current.Email@Example.COM");
});

test("Client Operations merges concurrent disjoint profile updates", async () => {
  const state = {
    _id: authenticatedClientId,
    name: "Existing Client",
    email: "current@example.com",
    image_url: null,
    coverImage_url: null,
    country: "Egypt",
  };
  const writes = [];
  let readsStarted = 0;
  let releaseReads;
  const bothReadsStarted = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const clientModel = {
    findById() {
      return {
        lean: async () => {
          readsStarted += 1;
          if (readsStarted === 2) releaseReads();
          await bothReadsStarted;
          return { ...state };
        },
      };
    },
    exists: async () => false,
    findByIdAndUpdate(_id, update) {
      writes.push(update);
      Object.assign(state, update.$set);
      return { lean: async () => ({ ...state }) };
    },
  };
  const operations = createClientOperations({
    adminModel: { exists: async () => false },
    clientModel,
    freelancerModel: { exists: async () => false },
  });

  await Promise.all([
    operations.updateProfile({
      clientId: authenticatedClientId,
      updates: { name: "Concurrent Name" },
    }),
    operations.updateProfile({
      clientId: authenticatedClientId,
      updates: { email: "concurrent@example.com" },
    }),
  ]);

  assert.equal(writes.length, 2);
  assert.equal(
    writes.some(
      (update) => update.$set.name === "Concurrent Name",
    ),
    true,
  );
  assert.equal(
    writes.some(
      (update) => update.$set.email === "concurrent@example.com",
    ),
    true,
  );
  assert.equal(state.name, "Concurrent Name");
  assert.equal(state.email, "concurrent@example.com");
});

test("Client profile update reports a missing Client Account", async () => {
  const controller = createUpdateClientProfileController({
    operations: createClientOperations({
      clientModel: {
        findById() {
          return { lean: async () => null };
        },
      },
    }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    updateProfileHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      message: "Client account not found.",
    });
  });
});

test("unexpected Client profile update failures use the exact generic response", async () => {
  const databaseError = new Error("private MongoDB update details");
  const loggedErrors = [];
  const controller = createUpdateClientProfileController({
    operations: {
      updateProfile: async () => {
        throw databaseError;
      },
    },
    logger: {
      error: (...values) => loggedErrors.push(values),
    },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    updateProfileHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl);
    const responseBody = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(responseBody, { message: "Internal server error." });
    assert.equal(Object.hasOwn(responseBody, "stack"), false);
  });

  assert.deepEqual(loggedErrors, [
    ["Failed to update Client profile.", databaseError],
  ]);
});

test("Client profile update uses shared authentication before media validation", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => {
      events.push("auth");
      return next();
    },
    updateProfileHandler: (_req, res) => {
      events.push("handler");
      return res.status(204).end();
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl, {
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

test("Client profile update requires the shared Client authentication middleware", async () => {
  const router = createClientsRouter();

  await withTestServer(router, async (baseUrl) => {
    const response = await requestProfileUpdate(baseUrl);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      message: "Invalid header token",
    });
  });
});

test("the legacy ID-targeted Client profile update route is absent", async () => {
  const router = createClientsRouter();

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/updateClientInfo/${authenticatedClientId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      },
    );

    assert.equal(response.status, 404);
  });
});

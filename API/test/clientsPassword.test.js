import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClientsRouter } from "../src/modules/clients/clientsRoutes.js";
import { createChangeClientPasswordController } from "../src/modules/clients/clientsController.js";
import { createClientOperations } from "../src/modules/clients/clientsOperations.js";
import { handleClientPasswordRequestParseError } from "../src/modules/clients/clientRequest.middleware.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

const authenticatedClientId = "507f1f77bcf86cd799439011";
const validPasswordBody = {
  currentPassword: "Legacy password",
  newPassword: "NewPassword1!",
  confirmPassword: "NewPassword1!",
};

const withTestServer = async (router, operation) => {
  const app = express();
  app.use(express.json());
  app.use(handleClientPasswordRequestParseError);
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

const requestPasswordChange = (
  baseUrl,
  {
    body = validPasswordBody,
    contentType = "application/json",
    method = "PATCH",
    path = "/api/v1/clients/me/password",
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

test("Client password change authenticates before request validation", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      events.push("auth");
      req.user = { _id: authenticatedClientId };
      return next();
    },
    clientPasswordRequestHandler: (req, res, next) => {
      events.push("request");
      res.locals.clientPasswordChange = req.body;
      return next();
    },
    changePasswordHandler: (req, res) => {
      events.push({
        step: "handler",
        clientId: req.user._id,
        input: res.locals.clientPasswordChange,
      });
      return res.status(200).json({ accepted: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
  });

  assert.deepEqual(events, [
    "auth",
    "request",
    {
      step: "handler",
      clientId: authenticatedClientId,
      input: validPasswordBody,
    },
  ]);
});

test("Client password change rejects unsupported media after authentication", async () => {
  const events = [];
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => {
      events.push("auth");
      return next();
    },
    changePasswordHandler: (_req, res) => {
      events.push("handler");
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl, {
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

test("Client password change rejects invalid request structures exactly", async () => {
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    changePasswordHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });
  const cases = [
    {
      name: "missing field",
      path: "/api/v1/clients/me/password",
      body: {
        newPassword: validPasswordBody.newPassword,
        confirmPassword: validPasswordBody.confirmPassword,
      },
    },
    {
      name: "extra field",
      path: "/api/v1/clients/me/password",
      body: { ...validPasswordBody, role: "admin" },
    },
    {
      name: "body identity",
      path: "/api/v1/clients/me/password",
      body: { ...validPasswordBody, clientId: authenticatedClientId },
    },
    {
      name: "body id",
      path: "/api/v1/clients/me/password",
      body: { ...validPasswordBody, id: authenticatedClientId },
    },
    {
      name: "body persistence identity",
      path: "/api/v1/clients/me/password",
      body: { ...validPasswordBody, _id: authenticatedClientId },
    },
    {
      name: "query identity",
      path: `/api/v1/clients/me/password?clientId=${authenticatedClientId}`,
      body: validPasswordBody,
    },
    {
      name: "non-string field",
      path: "/api/v1/clients/me/password",
      body: { ...validPasswordBody, currentPassword: 123 },
    },
    {
      name: "string JSON body",
      path: "/api/v1/clients/me/password",
      body: "submitted-password-value",
      secret: "submitted-password-value",
    },
    {
      name: "string JSON body on trailing-slash route alias",
      path: "/api/v1/clients/me/password/",
      body: "trailing-slash-password-value",
      secret: "trailing-slash-password-value",
    },
    {
      name: "string JSON body on case-insensitive route alias",
      path: "/api/v1/clients/ME/PASSWORD",
      body: "case-insensitive-password-value",
      secret: "case-insensitive-password-value",
    },
    {
      name: "numeric JSON body",
      path: "/api/v1/clients/me/password",
      body: 123,
    },
    {
      name: "null JSON body",
      path: "/api/v1/clients/me/password",
      body: null,
    },
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const testCase of cases) {
      const response = await requestPasswordChange(baseUrl, {
        body: testCase.body,
        path: testCase.path,
      });
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
        testCase.secret === undefined ||
          !JSON.stringify(responseBody).includes(testCase.secret),
        true,
        testCase.name,
      );
    }
  });
});

test("Client password change rejects malformed JSON without changing other error responses", async () => {
  const submittedSecret = "malformed-current-password";
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    changePasswordHandler: (_req, res) => res.status(204).end(),
  });

  await withTestServer(router, async (baseUrl) => {
    const passwordPaths = [
      "/api/v1/clients/me/password",
      "/api/v1/clients/me/password/",
      "/api/v1/clients/ME/PASSWORD",
    ];

    for (const path of passwordPaths) {
      const response = await requestPasswordChange(baseUrl, {
        path,
        rawBody: `{"currentPassword":"${submittedSecret}"`,
      });
      const responseBody = await response.json();

      assert.equal(response.status, 400, path);
      assert.deepEqual(responseBody, { message: "Invalid request." }, path);
      assert.equal(
        JSON.stringify(responseBody).includes(submittedSecret),
        false,
        path,
      );
    }

    const unrelatedResponse = await requestPasswordChange(baseUrl, {
      path: "/api/v1/clients/not-the-password-route",
      rawBody: "{",
    });
    const unrelatedBody = await unrelatedResponse.json();

    assert.equal(unrelatedResponse.status, 400);
    assert.equal(unrelatedBody.success, false);
  });
});

test("Client password change rejects a confirmation mismatch without leakage", async () => {
  const submittedBody = {
    ...validPasswordBody,
    confirmPassword: "DifferentPassword1!",
  };
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    changePasswordHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl, {
      body: submittedBody,
    });
    const responseBody = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, {
      message: "Password confirmation does not match.",
    });
    assert.equal(
      JSON.stringify(responseBody).includes(submittedBody.newPassword),
      false,
    );
    assert.equal(
      JSON.stringify(responseBody).includes(submittedBody.confirmPassword),
      false,
    );
  });
});

test("Client password change applies the shared policy only to the new password", async () => {
  const submittedBody = {
    currentPassword: "x",
    newPassword: "weak",
    confirmPassword: "weak",
  };
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    changePasswordHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl, {
      body: submittedBody,
    });
    const responseBody = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, {
      message: "New password does not meet requirements.",
    });
    assert.equal(JSON.stringify(responseBody).includes("weak"), false);
    assert.equal(JSON.stringify(responseBody).includes("pattern"), false);
  });
});

test("Client password change targets only the authenticated Client Account", async () => {
  const calls = [];
  const controller = createChangeClientPasswordController({
    operations: {
      changePassword: async (input) => {
        calls.push(input);
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Password updated successfully. Please sign in again.",
    });
  });

  assert.deepEqual(calls, [
    {
      clientId: authenticatedClientId,
      currentPassword: validPasswordBody.currentPassword,
      newPassword: validPasswordBody.newPassword,
    },
  ]);
});

test("Client Operations conditionally commits the complete password change", async () => {
  const observedPasswordHash = "observed-password-hash";
  const newPasswordHash = "new-password-hash";
  const calls = {
    findById: [],
    lean: 0,
    compare: [],
    hash: [],
    updateOne: [],
    exists: [],
  };
  const clientModel = {
    findById(id, projection) {
      calls.findById.push({ id, projection });

      return {
        async lean() {
          calls.lean += 1;
          return { password: observedPasswordHash };
        },
      };
    },
    async updateOne(filter, update) {
      calls.updateOne.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async exists(filter) {
      calls.exists.push(filter);
      return { _id: authenticatedClientId };
    },
  };
  const passwordHasher = {
    async compare(value, hash) {
      calls.compare.push({ value, hash });
      return value === validPasswordBody.currentPassword;
    },
    async hash(value, saltRounds) {
      calls.hash.push({ value, saltRounds });
      return newPasswordHash;
    },
  };
  const operations = createClientOperations({
    clientModel,
    passwordHasher,
    getPasswordSaltRounds: () => 12,
  });

  await operations.changePassword({
    clientId: authenticatedClientId,
    currentPassword: validPasswordBody.currentPassword,
    newPassword: validPasswordBody.newPassword,
  });

  assert.deepEqual(calls, {
    findById: [
      {
        id: authenticatedClientId,
        projection: { password: 1 },
      },
    ],
    lean: 1,
    compare: [
      {
        value: validPasswordBody.currentPassword,
        hash: observedPasswordHash,
      },
      {
        value: validPasswordBody.newPassword,
        hash: observedPasswordHash,
      },
    ],
    hash: [
      {
        value: validPasswordBody.newPassword,
        saltRounds: 12,
      },
    ],
    updateOne: [
      {
        filter: {
          _id: authenticatedClientId,
          password: observedPasswordHash,
        },
        update: {
          $set: {
            password: newPasswordHash,
            token: null,
            activityStatus: "offline",
          },
        },
      },
    ],
    exists: [],
  });
});

test("Client password change rejects an incorrect current password", async () => {
  const calls = { compare: [], hash: 0, updateOne: 0 };
  const loggedErrors = [];
  const clientModel = {
    findById() {
      return {
        async lean() {
          return { password: "observed-password-hash" };
        },
      };
    },
    async updateOne() {
      calls.updateOne += 1;
      return { matchedCount: 1 };
    },
  };
  const passwordHasher = {
    async compare(value, hash) {
      calls.compare.push({ value, hash });
      return false;
    },
    async hash() {
      calls.hash += 1;
      return "unexpected-hash";
    },
  };
  const controller = createChangeClientPasswordController({
    operations: createClientOperations({ clientModel, passwordHasher }),
    logger: {
      error: (...values) => loggedErrors.push(values),
    },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);
    const responseBody = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(responseBody, {
      message: "Current password is incorrect.",
    });
    assert.equal(
      JSON.stringify(responseBody).includes(
        validPasswordBody.currentPassword,
      ),
      false,
    );
  });

  assert.deepEqual(calls.compare, [
    {
      value: validPasswordBody.currentPassword,
      hash: "observed-password-hash",
    },
  ]);
  assert.equal(calls.hash, 0);
  assert.equal(calls.updateOne, 0);
  assert.deepEqual(loggedErrors, []);
});

test("Client password change rejects reuse of the current password", async () => {
  const calls = { compare: [], hash: 0, updateOne: 0 };
  const clientModel = {
    findById() {
      return {
        async lean() {
          return { password: "observed-password-hash" };
        },
      };
    },
    async updateOne() {
      calls.updateOne += 1;
      return { matchedCount: 1 };
    },
  };
  const passwordHasher = {
    async compare(value, hash) {
      calls.compare.push({ value, hash });
      return true;
    },
    async hash() {
      calls.hash += 1;
      return "unexpected-hash";
    },
  };
  const controller = createChangeClientPasswordController({
    operations: createClientOperations({ clientModel, passwordHasher }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "New password must be different from current password.",
    });
  });

  assert.deepEqual(calls.compare, [
    {
      value: validPasswordBody.currentPassword,
      hash: "observed-password-hash",
    },
    {
      value: validPasswordBody.newPassword,
      hash: "observed-password-hash",
    },
  ]);
  assert.equal(calls.hash, 0);
  assert.equal(calls.updateOne, 0);
});

test("Client password change reports a missing Client Account", async () => {
  const calls = { compare: 0, hash: 0, updateOne: 0 };
  const loggedErrors = [];
  const clientModel = {
    findById() {
      return {
        async lean() {
          return null;
        },
      };
    },
    async updateOne() {
      calls.updateOne += 1;
      return { matchedCount: 1 };
    },
  };
  const passwordHasher = {
    async compare() {
      calls.compare += 1;
      return true;
    },
    async hash() {
      calls.hash += 1;
      return "unexpected-hash";
    },
  };
  const controller = createChangeClientPasswordController({
    operations: createClientOperations({ clientModel, passwordHasher }),
    logger: {
      error: (...values) => loggedErrors.push(values),
    },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      message: "Client account not found.",
    });
  });

  assert.deepEqual(calls, { compare: 0, hash: 0, updateOne: 0 });
  assert.deepEqual(loggedErrors, []);
});

test("Client password change reports a conditional-write race", async () => {
  const calls = { updateOne: [], exists: [] };
  const clientModel = {
    findById() {
      return {
        async lean() {
          return { password: "observed-password-hash" };
        },
      };
    },
    async updateOne(filter, update) {
      calls.updateOne.push({ filter, update });
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async exists(filter) {
      calls.exists.push(filter);
      return { _id: authenticatedClientId };
    },
  };
  const passwordHasher = {
    async compare(value) {
      return value === validPasswordBody.currentPassword;
    },
    async hash() {
      return "new-password-hash";
    },
  };
  const controller = createChangeClientPasswordController({
    operations: createClientOperations({
      clientModel,
      passwordHasher,
      getPasswordSaltRounds: () => 12,
    }),
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      return next();
    },
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      message:
        "Password was changed by another request. Please sign in again.",
    });
  });

  assert.equal(calls.updateOne.length, 1);
  assert.deepEqual(calls.exists, [{ _id: authenticatedClientId }]);
});

test("Client Operations reports an account that disappears during the conditional write", async () => {
  const clientModel = {
    findById() {
      return {
        async lean() {
          return { password: "observed-password-hash" };
        },
      };
    },
    async updateOne() {
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async exists() {
      return null;
    },
  };
  const passwordHasher = {
    async compare(value) {
      return value === validPasswordBody.currentPassword;
    },
    async hash() {
      return "new-password-hash";
    },
  };
  const operations = createClientOperations({
    clientModel,
    passwordHasher,
    getPasswordSaltRounds: () => 12,
  });

  await assert.rejects(
    operations.changePassword({
      clientId: authenticatedClientId,
      currentPassword: validPasswordBody.currentPassword,
      newPassword: validPasswordBody.newPassword,
    }),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Client account not found.");
      return true;
    },
  );
});

test("Client Operations makes concurrent password changes first-writer-wins", async () => {
  let storedPasswordHash = "observed-password-hash";
  let readCount = 0;
  let releaseReads;
  const bothReadsStarted = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const calls = { updateOne: 0, exists: 0 };
  const clientModel = {
    findById() {
      return {
        async lean() {
          const observedPasswordHash = storedPasswordHash;
          readCount += 1;

          if (readCount === 2) {
            releaseReads();
          }

          await bothReadsStarted;
          return { password: observedPasswordHash };
        },
      };
    },
    async updateOne(filter, update) {
      calls.updateOne += 1;

      if (filter.password !== storedPasswordHash) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      storedPasswordHash = update.$set.password;
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async exists() {
      calls.exists += 1;
      return { _id: authenticatedClientId };
    },
  };
  const passwordHasher = {
    async compare(value) {
      return value === validPasswordBody.currentPassword;
    },
    async hash(value) {
      return `hash:${value}`;
    },
  };
  const operations = createClientOperations({
    clientModel,
    passwordHasher,
    getPasswordSaltRounds: () => 12,
  });

  const results = await Promise.allSettled([
    operations.changePassword({
      clientId: authenticatedClientId,
      currentPassword: validPasswordBody.currentPassword,
      newPassword: "FirstPassword1!",
    }),
    operations.changePassword({
      clientId: authenticatedClientId,
      currentPassword: validPasswordBody.currentPassword,
      newPassword: "SecondPassword2@",
    }),
  ]);

  const fulfilled = results.filter((result) => {
    return result.status === "fulfilled";
  });
  const rejected = results.filter((result) => {
    return result.status === "rejected";
  });

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 409);
  assert.equal(
    rejected[0].reason.message,
    "Password was changed by another request. Please sign in again.",
  );
  assert.equal(calls.updateOne, 2);
  assert.equal(calls.exists, 1);
  assert.ok(
    ["hash:FirstPassword1!", "hash:SecondPassword2@"].includes(
      storedPasswordHash,
    ),
  );
});

test("unexpected Client password failures use generic responses and safe logs", async () => {
  const loggedErrors = [];
  const databaseError = new Error(
    `private database failure: ${validPasswordBody.currentPassword} ${validPasswordBody.newPassword}`,
  );
  databaseError.code = "MONGO_WRITE_FAILED";
  const controller = createChangeClientPasswordController({
    operations: {
      changePassword: async () => {
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
    changePasswordHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);
    const responseBody = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(responseBody, { message: "Internal server error." });
    assert.equal(Object.hasOwn(responseBody, "stack"), false);
  });

  assert.deepEqual(loggedErrors, [
    [
      "Failed to change Client password.",
      { name: "Error", code: "MONGO_WRITE_FAILED" },
    ],
  ]);
  const serializedLogs = JSON.stringify(loggedErrors);
  assert.equal(
    serializedLogs.includes(validPasswordBody.currentPassword),
    false,
  );
  assert.equal(
    serializedLogs.includes(validPasswordBody.newPassword),
    false,
  );
  assert.equal(serializedLogs.includes("private database failure"), false);
});

test("Client password change requires the shared Client authentication middleware", async () => {
  const events = [];
  const router = createClientsRouter({
    clientPasswordRequestHandler: (_req, _res, next) => {
      events.push("request");
      return next();
    },
    changePasswordHandler: (_req, res) => {
      events.push("handler");
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await requestPasswordChange(baseUrl);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      message: "Invalid header token",
    });
  });

  assert.deepEqual(events, []);
});

test("legacy and ID-appended Client password routes are absent", async () => {
  const router = createClientsRouter({
    clientAuthHandler: (_req, _res, next) => next(),
    changePasswordHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const legacyResponse = await requestPasswordChange(baseUrl, {
      method: "PUT",
      path: `/api/v1/clients/updateClientPassword/${authenticatedClientId}`,
    });
    const idAppendedResponse = await requestPasswordChange(baseUrl, {
      path: `/api/v1/clients/me/password/${authenticatedClientId}`,
    });

    assert.equal(legacyResponse.status, 404);
    assert.equal(idAppendedResponse.status, 404);
  });
});

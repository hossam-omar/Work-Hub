import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { createClientsRouter } from "../src/modules/clients/clientsRoutes.js";
import {
  createClientProfileUpdateErrorHandler,
  createUpdateClientProfileController,
} from "../src/modules/clients/clientsController.js";
import { createClientOperations } from "../src/modules/clients/clientsOperations.js";
import {
  createClientProfileUpdateRequestHandler,
  handleClientProfileUpdateParseError,
} from "../src/modules/clients/clientRequest.middleware.js";
import { createClientImageLifecycle } from "../src/modules/clients/clientImageLifecycle.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

const authenticatedClientId = "507f1f77bcf86cd799439011";
const clientSelfProjection = {
  _id: 1,
  name: 1,
  email: 1,
  image_url: 1,
  coverImage_url: 1,
  country: 1,
};

const createImage = ({ format = "png", width = 32, height = 24 } = {}) => {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 100, b: 180, alpha: 0.8 },
    },
  })[format]().toBuffer();
};

const stageImage = async (imageLifecycle, { format = "png" } = {}) => {
  const extension = format === "jpeg" ? "jpg" : format;
  return imageLifecycle.stageUpload({
    stream: Readable.from(await createImage({ format })),
    originalName: `avatar.${extension}`,
    mimeType: `image/${format}`,
  });
};

const withImageLifecycle = async (operation, options = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-hub-profile-image-"));
  const stagingRoot = path.join(root, "private-staging");
  const uploadsRoot = path.join(root, "uploads");
  await Promise.all([
    mkdir(stagingRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
  const imageLifecycle = createClientImageLifecycle({
    stagingRoot,
    uploadsRoot,
    ...options,
  });

  try {
    await operation({ imageLifecycle, root, stagingRoot, uploadsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const withTestServer = async (
  {
    imageLifecycle,
    operations,
    logger = { error: () => undefined },
    correlationId,
  },
  operation,
) => {
  const app = express();
  app.use(express.json());
  app.use(handleClientProfileUpdateParseError);

  const controller = createUpdateClientProfileController({
    operations,
    logger,
  });
  const router = createClientsRouter({
    clientAuthHandler: (req, _res, next) => {
      req.user = { _id: authenticatedClientId };
      if (correlationId !== undefined) req.id = correlationId;
      return next();
    },
    clientProfileRequestHandler: createClientProfileUpdateRequestHandler({
      imageLifecycle,
    }),
    clientProfileErrorHandler: createClientProfileUpdateErrorHandler({
      logger,
    }),
    updateProfileHandler: controller,
  });

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

test("Client Profile image-only update conditionally persists a managed reference", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      const calls = [];
      const storedClient = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "client@example.com",
        image_url: null,
        coverImage_url: null,
        country: "Egypt",
      };
      const clientModel = {
        findById(id, projection) {
          assert.equal(id, authenticatedClientId);
          assert.deepEqual(projection, clientSelfProjection);
          return { lean: async () => ({ ...storedClient }) };
        },
        findOneAndUpdate(filter, update, options) {
          calls.push({ filter, update, options });
          return {
            lean: async () => ({ ...storedClient, ...update.$set }),
          };
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel,
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer({ imageLifecycle, operations }, async (baseUrl) => {
        const form = new FormData();
        form.append(
          "image",
          new Blob([await createImage()], { type: "image/png" }),
          "avatar.png",
        );
        const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
          method: "PATCH",
          body: form,
        });
        const responseBody = await response.json();

        assert.equal(response.status, 200);
        assert.equal(responseBody.message, "Client profile updated successfully.");
        assert.deepEqual(responseBody.client, {
          id: authenticatedClientId,
          name: "Existing Client",
          email: "client@example.com",
          imageUrl: calls[0].update.$set.image_url,
          coverImageUrl: null,
          country: "Egypt",
        });
      });

      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], {
        filter: { _id: authenticatedClientId, image_url: null },
        update: {
          $set: {
            image_url: calls[0].update.$set.image_url,
          },
        },
        options: { new: true, projection: clientSelfProjection },
      });
      assert.match(
        calls[0].update.$set.image_url,
        /^\/uploads\/client-[a-f0-9]{48}\.png$/,
      );
      const output = await readFile(
        path.join(uploadsRoot, path.basename(calls[0].update.$set.image_url)),
      );
      assert.equal((await sharp(output).metadata()).format, "png");
      assert.deepEqual(await readdir(stagingRoot), []);
    },
  );
});

test("Client Profile multipart rejects wrong, multiple, or extra inputs and discards staged images", async () => {
  const source = await createImage();
  const appendImage = (form, fieldName = "image", filename = "avatar.png") => {
    form.append(
      fieldName,
      new Blob([source], { type: "image/png" }),
      filename,
    );
  };

  for (const testCase of [
    {
      name: "empty multipart request",
      createForm() {
        return new FormData();
      },
    },
    {
      name: "wrong file field",
      createForm() {
        const form = new FormData();
        appendImage(form, "avatar");
        return form;
      },
    },
    {
      name: "multiple image files",
      createForm() {
        const form = new FormData();
        appendImage(form);
        appendImage(form, "image", "second.png");
        return form;
      },
    },
    {
      name: "extra file field",
      createForm() {
        const form = new FormData();
        appendImage(form);
        appendImage(form, "cover");
        return form;
      },
    },
    {
      name: "extra text field",
      createForm() {
        const form = new FormData();
        form.append("role", "admin");
        appendImage(form);
        return form;
      },
    },
    {
      name: "direct image reference text field",
      createForm() {
        const form = new FormData();
        form.append("image_url", "/uploads/attacker.png");
        return form;
      },
    },
    {
      name: "too many text fields",
      createForm() {
        const form = new FormData();
        appendImage(form);
        form.append("name", "Allowed Name");
        form.append("email", "allowed@example.com");
        form.append("role", "admin");
        return form;
      },
    },
    {
      name: "duplicate text field",
      createForm() {
        const form = new FormData();
        form.append("name", "First Name");
        form.append("name", "Second Name");
        appendImage(form);
        return form;
      },
    },
    {
      name: "query field",
      path: `/api/v1/clients/me?clientId=${authenticatedClientId}`,
      createForm() {
        const form = new FormData();
        appendImage(form);
        return form;
      },
    },
  ]) {
    await withImageLifecycle(
      async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
        let operationCalls = 0;
        const operations = {
          updateProfile: async () => {
            operationCalls += 1;
            throw new Error("invalid multipart must not reach operations");
          },
        };

        await withTestServer(
          { imageLifecycle, operations },
          async (baseUrl) => {
            const response = await fetch(
              `${baseUrl}${testCase.path ?? "/api/v1/clients/me"}`,
              { method: "PATCH", body: testCase.createForm() },
            );
            assert.equal(response.status, 400, testCase.name);
            assert.deepEqual(
              await response.json(),
              { message: "Invalid request." },
              testCase.name,
            );
          },
        );

        assert.equal(operationCalls, 0, testCase.name);
        assert.deepEqual(await readdir(stagingRoot), [], testCase.name);
        assert.deepEqual(await readdir(uploadsRoot), [], testCase.name);
      },
    );
  }
});

test("Client Profile maps transport size separately from every other invalid image", async () => {
  const cases = [
    {
      name: "transport size",
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      filename: "large.png",
      mimeType: "image/png",
      expectedStatus: 413,
      expectedBody: { message: "Payload too large." },
    },
    {
      name: "invalid decoded content",
      bytes: Buffer.from("private sharp parser detail"),
      filename: "invalid.png",
      mimeType: "image/png",
      expectedStatus: 400,
      expectedBody: { message: "Invalid image file." },
    },
    {
      name: "MIME and extension mismatch",
      bytes: await createImage(),
      filename: "submitted-secret.jpg",
      mimeType: "image/png",
      expectedStatus: 400,
      expectedBody: { message: "Invalid image file." },
    },
  ];

  for (const testCase of cases) {
    await withImageLifecycle(
      async ({ imageLifecycle, root, stagingRoot, uploadsRoot }) => {
        const logs = [];
        const operations = createClientOperations({
          adminModel: { exists: async () => false },
          clientModel: {
            findById() {
              return {
                lean: async () => ({
                  _id: authenticatedClientId,
                  name: "Existing Client",
                  email: "client@example.com",
                  image_url: null,
                  coverImage_url: null,
                  country: "Egypt",
                }),
              };
            },
          },
          freelancerModel: { exists: async () => false },
          imageLifecycle,
        });

        await withTestServer(
          {
            imageLifecycle,
            operations,
            logger: { error: (...values) => logs.push(values) },
          },
          async (baseUrl) => {
            const form = new FormData();
            form.append(
              "image",
              new Blob([testCase.bytes], { type: testCase.mimeType }),
              testCase.filename,
            );
            const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
              method: "PATCH",
              body: form,
            });
            const responseBody = await response.json();

            assert.equal(response.status, testCase.expectedStatus, testCase.name);
            assert.deepEqual(responseBody, testCase.expectedBody, testCase.name);
            const serializedResponse = JSON.stringify(responseBody);
            assert.equal(
              serializedResponse.includes(testCase.filename),
              false,
              testCase.name,
            );
            assert.equal(
              serializedResponse.includes("sharp"),
              false,
              testCase.name,
            );
            assert.equal(serializedResponse.includes(root), false, testCase.name);
          },
        );

        assert.deepEqual(logs, [], testCase.name);
        assert.deepEqual(await readdir(stagingRoot), [], testCase.name);
        assert.deepEqual(await readdir(uploadsRoot), [], testCase.name);
      },
    );
  }
});

test("Client Profile maps an oversized processed image to the safe invalid-image response", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel: {
          findById() {
            return {
              lean: async () => ({
                _id: authenticatedClientId,
                name: "Existing Client",
                email: "client@example.com",
                image_url: null,
                coverImage_url: null,
                country: "Egypt",
              }),
            };
          },
        },
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer({ imageLifecycle, operations }, async (baseUrl) => {
        const form = new FormData();
        form.append(
          "image",
          new Blob([await createImage()], { type: "image/png" }),
          "avatar.png",
        );
        const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
          method: "PATCH",
          body: form,
        });

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          message: "Invalid image file.",
        });
      });

      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      statFn: async (target) => {
        const information = await stat(target);
        if (path.basename(target).startsWith("processed.")) {
          return { dev: information.dev, size: 5 * 1024 * 1024 + 1 };
        }
        return information;
      },
    },
  );
});

test("Client Profile maps image storage failures to a redacted generic response and log", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle, root, stagingRoot, uploadsRoot }) => {
      const logs = [];
      await withTestServer(
        {
          imageLifecycle,
          operations: {
            updateProfile: async () => {
              throw new Error("storage failure must not reach operations");
            },
          },
          logger: { error: (...values) => logs.push(values) },
        },
        async (baseUrl) => {
          const form = new FormData();
          form.append(
            "image",
            new Blob([await createImage()], { type: "image/png" }),
            "avatar.png",
          );
          const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
            method: "PATCH",
            body: form,
          });

          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), {
            message: "Internal server error.",
          });
        },
      );

      assert.deepEqual(logs, [
        [
          "Failed to update Client profile.",
          {
            name: "ClientImageLifecycleError",
            category: "storage_failure",
          },
        ],
      ]);
      assert.equal(JSON.stringify(logs).includes(root), false);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      createWriteStreamFn: (target) => {
        throw Object.assign(new Error(`EACCES opening '${target}'`), {
          code: "EACCES",
        });
      },
    },
  );
});

test("Client Profile accepts multipart text-only updates without an image condition", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle, uploadsRoot }) => {
      const calls = [];
      const storedClient = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "current@example.com",
        image_url: "/uploads/external-legacy.png",
        coverImage_url: null,
        country: "Egypt",
      };
      const clientModel = {
        findById() {
          return { lean: async () => ({ ...storedClient }) };
        },
        exists: async () => false,
        findByIdAndUpdate(id, update, options) {
          calls.push({ id, update, options });
          return { lean: async () => ({ ...storedClient, ...update.$set }) };
        },
        findOneAndUpdate() {
          throw new Error("text-only update must remain last-write-wins");
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel,
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer({ imageLifecycle, operations }, async (baseUrl) => {
        const form = new FormData();
        form.append("name", "  Multipart Client  ");
        form.append("email", "  MULTIPART@Example.DEV  ");
        const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
          method: "PATCH",
          body: form,
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          message: "Client profile updated successfully.",
          client: {
            id: authenticatedClientId,
            name: "Multipart Client",
            email: "multipart@example.dev",
            imageUrl: "/uploads/external-legacy.png",
            coverImageUrl: null,
            country: "Egypt",
          },
        });
      });

      assert.deepEqual(calls, [
        {
          id: authenticatedClientId,
          update: {
            $set: {
              name: "Multipart Client",
              email: "multipart@example.dev",
            },
          },
          options: { new: true, projection: clientSelfProjection },
        },
      ]);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
  );
});

test("Client Profile mixed multipart update persists text and image atomically", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle }) => {
      const calls = [];
      const storedClient = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "current@example.com",
        image_url: "https://legacy.example/client.png",
        coverImage_url: null,
        country: "Egypt",
      };
      const clientModel = {
        findById() {
          return { lean: async () => ({ ...storedClient }) };
        },
        exists: async () => false,
        findByIdAndUpdate() {
          throw new Error("mixed update must use one conditional mutation");
        },
        findOneAndUpdate(filter, update, options) {
          calls.push({ filter, update, options });
          return { lean: async () => ({ ...storedClient, ...update.$set }) };
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel,
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer({ imageLifecycle, operations }, async (baseUrl) => {
        const form = new FormData();
        form.append("name", "  Mixed Client  ");
        form.append("email", "  MIXED@Example.DEV  ");
        form.append(
          "image",
          new Blob([await createImage({ format: "webp" })], {
            type: "image/webp",
          }),
          "mixed.webp",
        );
        const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
          method: "PATCH",
          body: form,
        });

        assert.equal(response.status, 200);
        const responseBody = await response.json();
        assert.equal(responseBody.client.name, "Mixed Client");
        assert.equal(responseBody.client.email, "mixed@example.dev");
        assert.equal(
          responseBody.client.imageUrl,
          calls[0].update.$set.image_url,
        );
      });

      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].filter, {
        _id: authenticatedClientId,
        image_url: "https://legacy.example/client.png",
      });
      assert.equal(calls[0].update.$set.name, "Mixed Client");
      assert.equal(calls[0].update.$set.email, "mixed@example.dev");
      assert.match(
        calls[0].update.$set.image_url,
        /^\/uploads\/client-[a-f0-9]{48}\.webp$/,
      );
      assert.deepEqual(calls[0].options, {
        new: true,
        projection: clientSelfProjection,
      });
    },
  );
});

test("Client Operations discards a staged image when email validation detects a conflict", async () => {
  let stagingCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      let updateCalls = 0;
      const operations = createClientOperations({
        adminModel: { exists: async () => ({ _id: "conflicting-admin" }) },
        clientModel: {
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
          findOneAndUpdate() {
            updateCalls += 1;
            throw new Error("email conflict must prevent mutation");
          },
        },
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });
      const uploadHandle = await stageImage(imageLifecycle);

      await assert.rejects(
        () =>
          operations.updateProfile({
            clientId: authenticatedClientId,
            updates: { email: "taken@example.com" },
            imageUploadHandle: uploadHandle,
          }),
        (error) => {
          assert.equal(error.statusCode, 409);
          assert.equal(error.message, "Email is already in use.");
          return true;
        },
      );

      assert.equal(updateCalls, 0);
      assert.equal(stagingCleanupCalls, 1);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      rmFn: async (target, options) => {
        stagingCleanupCalls += 1;
        await rm(target, options);
      },
    },
  );
});

test("Client Operations discards a staged image when the Client Account is unavailable", async () => {
  let stagingCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      const operations = createClientOperations({
        clientModel: {
          findById() {
            return { lean: async () => null };
          },
        },
        imageLifecycle,
      });
      const uploadHandle = await stageImage(imageLifecycle);

      await assert.rejects(
        () =>
          operations.updateProfile({
            clientId: authenticatedClientId,
            updates: {},
            imageUploadHandle: uploadHandle,
          }),
        (error) => {
          assert.equal(error.statusCode, 404);
          assert.equal(error.message, "Client account not found.");
          return true;
        },
      );

      assert.equal(stagingCleanupCalls, 1);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      rmFn: async (target, options) => {
        stagingCleanupCalls += 1;
        await rm(target, options);
      },
    },
  );
});

test("Client Operations rejects a losing mixed image update without applying text", async () => {
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      const storedClient = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "current@example.com",
        image_url: `/uploads/client-${"a".repeat(48)}.jpg`,
        coverImage_url: null,
        country: "Egypt",
      };
      const calls = { conditionalUpdates: [], existenceChecks: [] };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel: {
          findById() {
            return { lean: async () => ({ ...storedClient }) };
          },
          exists: async (filter) => {
            calls.existenceChecks.push(filter);
            return true;
          },
          findOneAndUpdate(filter, update) {
            calls.conditionalUpdates.push({ filter, update });
            return { lean: async () => null };
          },
        },
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });
      const uploadHandle = await stageImage(imageLifecycle);

      await assert.rejects(
        () =>
          operations.updateProfile({
            clientId: authenticatedClientId,
            updates: { name: "Losing Name" },
            imageUploadHandle: uploadHandle,
          }),
        (error) => {
          assert.equal(error.statusCode, 409);
          assert.equal(error.message, "Client profile changed; please retry.");
          return true;
        },
      );

      assert.equal(storedClient.name, "Existing Client");
      assert.equal(calls.conditionalUpdates.length, 1);
      assert.deepEqual(calls.conditionalUpdates[0].filter, {
        _id: authenticatedClientId,
        image_url: storedClient.image_url,
      });
      assert.deepEqual(calls.conditionalUpdates[0].update.$set.name, "Losing Name");
      assert.deepEqual(calls.existenceChecks, [{ _id: authenticatedClientId }]);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
  );
});

test("Client Profile value validation preserves its response and discards the staged image once", async () => {
  let stagingCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      let operationCalls = 0;
      await withTestServer(
        {
          imageLifecycle,
          operations: {
            updateProfile: async () => {
              operationCalls += 1;
            },
          },
        },
        async (baseUrl) => {
          const form = new FormData();
          form.append("name", "x");
          form.append(
            "image",
            new Blob([await createImage()], { type: "image/png" }),
            "avatar.png",
          );
          const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
            method: "PATCH",
            body: form,
          });

          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), {
            message: "Validation failed.",
            errors: {
              name: "Name must be between 2 and 100 characters.",
            },
          });
        },
      );

      assert.equal(operationCalls, 0);
      assert.equal(stagingCleanupCalls, 1);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      rmFn: async (target, options) => {
        stagingCleanupCalls += 1;
        await rm(target, options);
      },
    },
  );
});

test("Client Operations cleans a promoted image once before preserving database failures", async (t) => {
  for (const testCase of [
    {
      name: "Client email duplicate key",
      updates: { email: "updated@example.com" },
      createError() {
        return Object.assign(new Error("private duplicate details"), {
          code: 11000,
          keyPattern: { email: 1 },
        });
      },
      assertError(error) {
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "Email is already in use.");
      },
    },
    {
      name: "database failure",
      updates: { name: "Updated Client" },
      createError() {
        return new Error("private database details");
      },
      assertError(error, expectedError) {
        assert.equal(error, expectedError);
      },
    },
  ]) {
    await t.test(testCase.name, async () => {
      let stagingCleanupCalls = 0;
      let promotedCleanupCalls = 0;
      await withImageLifecycle(
        async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
          const databaseError = testCase.createError();
          const operations = createClientOperations({
            adminModel: { exists: async () => false },
            clientModel: {
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
              findOneAndUpdate() {
                return {
                  lean: async () => {
                    throw databaseError;
                  },
                };
              },
            },
            freelancerModel: { exists: async () => false },
            imageLifecycle,
          });
          const uploadHandle = await stageImage(imageLifecycle);

          await assert.rejects(
            () =>
              operations.updateProfile({
                clientId: authenticatedClientId,
                updates: testCase.updates,
                imageUploadHandle: uploadHandle,
              }),
            (error) => {
              testCase.assertError(error, databaseError);
              return true;
            },
          );

          assert.equal(stagingCleanupCalls, 1);
          assert.equal(promotedCleanupCalls, 1);
          assert.deepEqual(await readdir(stagingRoot), []);
          assert.deepEqual(await readdir(uploadsRoot), []);
        },
        {
          rmFn: async (target, options) => {
            stagingCleanupCalls += 1;
            await rm(target, options);
          },
          unlinkFn: async (target) => {
            promotedCleanupCalls += 1;
            await unlink(target);
          },
        },
      );
    });
  }
});

test("two concurrent image replacements retain one winner and clean the loser", async () => {
  let stagingCleanupCalls = 0;
  let managedCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, stagingRoot, uploadsRoot }) => {
      const oldReference = `/uploads/client-${"b".repeat(48)}.jpg`;
      await writeFile(
        path.join(uploadsRoot, path.basename(oldReference)),
        "old managed image",
      );
      const state = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "current@example.com",
        image_url: oldReference,
        coverImage_url: null,
        country: "Egypt",
      };
      let readsStarted = 0;
      let releaseReads;
      const bothReadsStarted = new Promise((resolve) => {
        releaseReads = resolve;
      });
      const clientModel = {
        findById() {
          return {
            lean: async () => {
              const snapshot = { ...state };
              readsStarted += 1;
              if (readsStarted === 2) releaseReads();
              await bothReadsStarted;
              return snapshot;
            },
          };
        },
        exists: async () => true,
        findOneAndUpdate(filter, update) {
          return {
            lean: async () => {
              if (state.image_url !== filter.image_url) return null;
              Object.assign(state, update.$set);
              return { ...state };
            },
          };
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel,
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });
      const [firstHandle, secondHandle] = await Promise.all([
        stageImage(imageLifecycle),
        stageImage(imageLifecycle),
      ]);

      const results = await Promise.allSettled([
        operations.updateProfile({
          clientId: authenticatedClientId,
          updates: { name: "First Candidate" },
          imageUploadHandle: firstHandle,
        }),
        operations.updateProfile({
          clientId: authenticatedClientId,
          updates: { name: "Second Candidate" },
          imageUploadHandle: secondHandle,
        }),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.statusCode, 409);
      assert.equal(
        rejected[0].reason.message,
        "Client profile changed; please retry.",
      );
      assert.equal(fulfilled[0].value.name, state.name);
      assert.equal(fulfilled[0].value.imageUrl, state.image_url);
      assert.equal(
        ["First Candidate", "Second Candidate"].includes(state.name),
        true,
      );
      assert.equal(stagingCleanupCalls, 2);
      assert.equal(managedCleanupCalls, 2);
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), [path.basename(state.image_url)]);
    },
    {
      rmFn: async (target, options) => {
        stagingCleanupCalls += 1;
        await rm(target, options);
      },
      unlinkFn: async (target) => {
        managedCleanupCalls += 1;
        await unlink(target);
      },
    },
  );
});

test("previous managed-image cleanup runs after database success and cannot replace 200", async () => {
  const cleanupEvents = [];
  let databaseSucceeded = false;
  let oldCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, root, uploadsRoot }) => {
      const oldReference = `/uploads/client-${"c".repeat(48)}.jpg`;
      const oldTarget = path.join(uploadsRoot, path.basename(oldReference));
      await writeFile(oldTarget, "old managed image");
      const storedClient = {
        _id: authenticatedClientId,
        name: "Existing Client",
        email: "current@example.com",
        image_url: oldReference,
        coverImage_url: null,
        country: "Egypt",
      };
      const clientModel = {
        findById() {
          return { lean: async () => ({ ...storedClient }) };
        },
        findOneAndUpdate(_filter, update) {
          return {
            lean: async () => {
              databaseSucceeded = true;
              return { ...storedClient, ...update.$set };
            },
          };
        },
      };
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel,
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer(
        {
          imageLifecycle,
          operations,
          correlationId: "request-43",
        },
        async (baseUrl) => {
          const form = new FormData();
          form.append(
            "image",
            new Blob([await createImage()], { type: "image/png" }),
            "replacement.png",
          );
          const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
            method: "PATCH",
            body: form,
          });
          const responseBody = await response.json();

          assert.equal(response.status, 200);
          assert.equal(responseBody.message, "Client profile updated successfully.");
          assert.match(
            responseBody.client.imageUrl,
            /^\/uploads\/client-[a-f0-9]{48}\.png$/,
          );
        },
      );

      assert.equal(databaseSucceeded, true);
      assert.equal(oldCleanupCalls, 1);
      assert.deepEqual(cleanupEvents, [
        {
          phase: "cleanup",
          operation: "replace-client-image",
          reference: oldReference,
          code: "EPERM",
          message: "EPERM: access denied, unlink '[path]'.",
          correlationId: "request-43",
        },
      ]);
      assert.equal(JSON.stringify(cleanupEvents).includes(root), false);
      assert.equal(await readFile(oldTarget, "utf8"), "old managed image");
      const retainedFiles = (await readdir(uploadsRoot)).filter(
        (filename) => filename !== path.basename(oldReference),
      );
      assert.equal(retainedFiles.length, 1);
    },
    {
      logger: { error: (event) => cleanupEvents.push(event) },
      unlinkFn: async (target) => {
        assert.equal(databaseSucceeded, true);
        oldCleanupCalls += 1;
        throw Object.assign(
          new Error(`EPERM: access denied, unlink '${target}'.`),
          { code: "EPERM" },
        );
      },
    },
  );
});

test("external, default, unsafe, and missing previous images are never deletion targets", async () => {
  for (const oldReference of [
    "https://legacy.example/avatar.jpg",
    "/uploads/default.png",
    "/uploads/../outside.jpg",
    `/uploads/client-${"d".repeat(48)}.webp`,
  ]) {
    let unlinkCalls = 0;
    await withImageLifecycle(
      async ({ imageLifecycle, uploadsRoot }) => {
        const storedClient = {
          _id: authenticatedClientId,
          name: "Existing Client",
          email: "current@example.com",
          image_url: oldReference,
          coverImage_url: null,
          country: "Egypt",
        };
        const operations = createClientOperations({
          adminModel: { exists: async () => false },
          clientModel: {
            findById() {
              return { lean: async () => ({ ...storedClient }) };
            },
            findOneAndUpdate(_filter, update) {
              return {
                lean: async () => ({ ...storedClient, ...update.$set }),
              };
            },
          },
          freelancerModel: { exists: async () => false },
          imageLifecycle,
        });
        const result = await operations.updateProfile({
          clientId: authenticatedClientId,
          updates: {},
          imageUploadHandle: await stageImage(imageLifecycle),
        });

        assert.match(
          result.imageUrl,
          /^\/uploads\/client-[a-f0-9]{48}\.png$/,
          oldReference,
        );
        assert.equal(unlinkCalls, 0, oldReference);
        assert.deepEqual(await readdir(uploadsRoot), [
          path.basename(result.imageUrl),
        ]);
      },
      {
        unlinkFn: async () => {
          unlinkCalls += 1;
        },
      },
    );
  }
});

test("database failure remains primary when promoted-image cleanup fails", async () => {
  const cleanupEvents = [];
  let promotedCleanupCalls = 0;
  await withImageLifecycle(
    async ({ imageLifecycle, root, stagingRoot, uploadsRoot }) => {
      const databaseError = new Error("private database failure");
      const controllerLogs = [];
      const operations = createClientOperations({
        adminModel: { exists: async () => false },
        clientModel: {
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
          findOneAndUpdate() {
            return {
              lean: async () => {
                throw databaseError;
              },
            };
          },
        },
        freelancerModel: { exists: async () => false },
        imageLifecycle,
      });

      await withTestServer(
        {
          imageLifecycle,
          operations,
          logger: { error: (...values) => controllerLogs.push(values) },
          correlationId: "request-43-failure",
        },
        async (baseUrl) => {
          const form = new FormData();
          form.append(
            "image",
            new Blob([await createImage()], { type: "image/png" }),
            "replacement.png",
          );
          const response = await fetch(`${baseUrl}/api/v1/clients/me`, {
            method: "PATCH",
            body: form,
          });

          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), {
            message: "Internal server error.",
          });
        },
      );

      assert.equal(promotedCleanupCalls, 1);
      assert.deepEqual(controllerLogs, [
        [
          "Failed to update Client profile.",
          { name: "Error", code: undefined },
        ],
      ]);
      assert.equal(cleanupEvents.length, 1);
      assert.equal(cleanupEvents[0].operation, "discard-unretained-client-image");
      assert.equal(cleanupEvents[0].correlationId, "request-43-failure");
      assert.equal(JSON.stringify(cleanupEvents).includes(root), false);
      assert.equal(JSON.stringify(controllerLogs).includes(root), false);
      assert.equal(
        JSON.stringify(controllerLogs).includes(databaseError.message),
        false,
      );
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.equal((await readdir(uploadsRoot)).length, 1);
    },
    {
      logger: { error: (event) => cleanupEvents.push(event) },
      unlinkFn: async (target) => {
        promotedCleanupCalls += 1;
        throw Object.assign(new Error(`EACCES unlink '${target}'`), {
          code: "EACCES",
        });
      },
    },
  );
});

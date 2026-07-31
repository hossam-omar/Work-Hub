import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClientsRouter } from "../src/modules/clients/clientsRoutes.js";
import {
  createGetPublicProfileByIdController,
  createListPublicProfilesController,
} from "../src/modules/clients/clientsController.js";
import { createClientOperations } from "../src/modules/clients/clientsOperations.js";
import ClientModel from "../DB/models/client_model.js";

const publicClientId = "507f1f77bcf86cd799439011";

const withTestServer = async (router, operation) => {
  const app = express();
  app.use("/api/v1/clients", router);

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

test("public Client Profile list uses the confirmed pagination defaults", async () => {
  const calls = [];
  const expectedResponse = {
    clients: [],
    pagination: {
      page: 1,
      limit: 20,
      totalClients: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async (pagination) => {
        calls.push(pagination);
        return expectedResponse;
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    listPublicProfilesHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/clients`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedResponse);
  });

  assert.deepEqual(calls, [{ page: 1, limit: 20 }]);
});

test("public Client Profile lookup uses the confirmed unauthenticated route", async () => {
  const calls = [];
  const expectedResponse = {
    client: {
      id: publicClientId,
      name: "Hossam",
      imageUrl: "/uploads/avatar.jpg",
      coverImageUrl: null,
      country: "Egypt",
    },
  };
  const router = createClientsRouter({
    getPublicProfileByIdHandler: (req, res) => {
      calls.push({
        id: res.locals.publicClientProfileId,
        params: req.params,
        query: req.query,
      });
      return res.status(200).json(expectedResponse);
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/${publicClientId}`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedResponse);
  });

  assert.deepEqual(calls, [
    {
      id: publicClientId,
      params: { id: publicClientId },
      query: {},
    },
  ]);
});

test("public Client Profile lookup returns the exact Client Operations result", async () => {
  const calls = [];
  const uppercaseClientId = publicClientId.toUpperCase();
  const publicProfile = {
    id: publicClientId,
    name: "Hossam",
    imageUrl: "/uploads/avatar.jpg",
    coverImageUrl: null,
    country: "Egypt",
  };
  const controller = createGetPublicProfileByIdController({
    operations: {
      getPublicProfileById: async (id) => {
        calls.push(id);
        return publicProfile;
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    getPublicProfileByIdHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/${uppercaseClientId}`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { client: publicProfile });
  });

  assert.deepEqual(calls, [uppercaseClientId]);
});

test("public Client Profile lookup rejects a malformed ObjectId", async () => {
  const controller = createGetPublicProfileByIdController({
    operations: {
      getPublicProfileById: async () => {
        throw new Error("invalid id reached Client Operations");
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    getPublicProfileByIdHandler: controller,
  });

  const malformedIds = [
    "not-an-object-id",
    "g".repeat(24),
    publicClientId.slice(1),
    `${publicClientId}00`,
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const id of malformedIds) {
      const response = await fetch(`${baseUrl}/api/v1/clients/${id}`);

      assert.equal(response.status, 400, id);
      assert.deepEqual(
        await response.json(),
        { message: "Client id must be a valid ObjectId." },
        id,
      );
    }
  });
});

test("public Client Profile lookup rejects unknown query parameters", async () => {
  const controller = createGetPublicProfileByIdController({
    operations: {
      getPublicProfileById: async () => {
        throw new Error("invalid query reached Client Operations");
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    getPublicProfileByIdHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/${publicClientId}?include=email`,
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "Invalid request.",
    });
  });
});

const createClientModelAdapter = ({ clients = [], totalClients = 0 } = {}) => {
  const calls = {
    find: [],
    sort: [],
    skip: [],
    limit: [],
    lean: 0,
    countDocuments: 0,
  };
  const query = {
    sort(value) {
      calls.sort.push(value);
      return this;
    },
    skip(value) {
      calls.skip.push(value);
      return this;
    },
    limit(value) {
      calls.limit.push(value);
      return this;
    },
    async lean() {
      calls.lean += 1;
      return clients;
    },
  };
  const clientModel = {
    find(filter, projection) {
      calls.find.push({ filter, projection });
      return query;
    },
    async countDocuments() {
      calls.countDocuments += 1;
      return totalClients;
    },
  };

  return { calls, clientModel };
};

const createClientLookupModelAdapter = ({ client = null } = {}) => {
  const calls = {
    findById: [],
    lean: 0,
  };
  const clientModel = {
    findById(id, projection) {
      calls.findById.push({ id, projection });

      return {
        async lean() {
          calls.lean += 1;
          return client;
        },
      };
    },
  };

  return { calls, clientModel };
};

test("Client Operations applies the bounded deterministic public Client Profile query", async () => {
  const storedClients = [
    {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      name: "Hossam",
      email: "private@example.com",
      password: "private-hash",
      token: "private-token",
      image_url: "avatar.jpg",
      coverImage_url: "/uploads/cover.webp",
      country: "Egypt",
      role: "client",
      futurePrivateField: "must-not-leak",
    },
  ];
  const { calls, clientModel } = createClientModelAdapter({
    clients: storedClients,
    totalClients: 5,
  });
  const operations = createClientOperations({ clientModel });

  const result = await operations.listPublicProfiles({ page: 2, limit: 2 });

  assert.deepEqual(calls, {
    find: [
      {
        filter: {},
        projection: {
          _id: 1,
          name: 1,
          image_url: 1,
          coverImage_url: 1,
          country: 1,
        },
      },
    ],
    sort: [{ createdAt: -1, _id: -1 }],
    skip: [2],
    limit: [2],
    lean: 1,
    countDocuments: 1,
  });
  assert.deepEqual(result, {
    clients: [
      {
        id: "507f1f77bcf86cd799439011",
        name: "Hossam",
        imageUrl: "/uploads/avatar.jpg",
        coverImageUrl: "/uploads/cover.webp",
        country: "Egypt",
      },
    ],
    pagination: {
      page: 2,
      limit: 2,
      totalClients: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    },
  });
});

test("Client Operations returns the exact public Client Profile for an uppercase ObjectId", async () => {
  const uppercaseClientId = publicClientId.toUpperCase();
  const { calls, clientModel } = createClientLookupModelAdapter({
    client: {
      _id: publicClientId,
      name: "Hossam",
      email: "private@example.com",
      password: "private-hash",
      token: "private-token",
      image_url: "https://legacy.example/uploads/avatar.jpg",
      coverImage_url: "C:\\private\\cover.png",
      country: "Egypt",
      role: "client",
      futurePrivateField: "must-not-leak",
    },
  });
  const operations = createClientOperations({ clientModel });

  const result = await operations.getPublicProfileById(uppercaseClientId);

  assert.deepEqual(calls, {
    findById: [
      {
        id: uppercaseClientId,
        projection: {
          _id: 1,
          name: 1,
          image_url: 1,
          coverImage_url: 1,
          country: 1,
        },
      },
    ],
    lean: 1,
  });
  assert.deepEqual(result, {
    id: publicClientId,
    name: "Hossam",
    imageUrl: "/uploads/avatar.jpg",
    coverImageUrl: null,
    country: "Egypt",
  });
});

test("public Client Profile lookup returns the exact missing-profile response", async () => {
  const { clientModel } = createClientLookupModelAdapter();
  const operations = createClientOperations({ clientModel });
  const controller = createGetPublicProfileByIdController({
    operations,
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    getPublicProfileByIdHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/${publicClientId}`,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      message: "Client profile not found.",
    });
  });
});

test("empty and out-of-range Client Profile pages remain successful", async (t) => {
  await t.test("empty collection", async () => {
    const { clientModel } = createClientModelAdapter({
      clients: [],
      totalClients: 0,
    });
    const operations = createClientOperations({ clientModel });

    const result = await operations.listPublicProfiles({
      page: 9,
      limit: 20,
    });

    assert.deepEqual(result, {
      clients: [],
      pagination: {
        page: 9,
        limit: 20,
        totalClients: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  await t.test("page above the last result page", async () => {
    const { clientModel } = createClientModelAdapter({
      clients: [],
      totalClients: 5,
    });
    const operations = createClientOperations({ clientModel });

    const result = await operations.listPublicProfiles({
      page: 9,
      limit: 2,
    });

    assert.deepEqual(result, {
      clients: [],
      pagination: {
        page: 9,
        limit: 2,
        totalClients: 5,
        totalPages: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
  });
});

test("public Client Profile image references never expose origins or filesystem paths", async () => {
  const { clientModel } = createClientModelAdapter({
    clients: [
      {
        _id: "507f1f77bcf86cd799439011",
        name: "One",
        image_url: "https://legacy.example/uploads/one.png",
        coverImage_url: "C:\\private\\cover.png",
        country: "Egypt",
      },
      {
        _id: "507f1f77bcf86cd799439012",
        name: "Two",
        image_url: "uploads/two.webp",
        coverImage_url: null,
        country: "Egypt",
      },
    ],
    totalClients: 2,
  });
  const operations = createClientOperations({ clientModel });

  const result = await operations.listPublicProfiles({
    page: 1,
    limit: 20,
  });

  assert.deepEqual(result.clients, [
    {
      id: "507f1f77bcf86cd799439011",
      name: "One",
      imageUrl: "/uploads/one.png",
      coverImageUrl: null,
      country: "Egypt",
    },
    {
      id: "507f1f77bcf86cd799439012",
      name: "Two",
      imageUrl: "/uploads/two.webp",
      coverImageUrl: null,
      country: "Egypt",
    },
  ]);
});

test("public Client Profile images reject encoded path separators and traversal", async () => {
  const { clientModel } = createClientModelAdapter({
    clients: [
      {
        _id: "507f1f77bcf86cd799439011",
        name: "One",
        image_url: "/uploads/..%2Fprivate.txt",
        coverImage_url: "/uploads/a%5Cb.jpg",
        country: "Egypt",
      },
      {
        _id: "507f1f77bcf86cd799439012",
        name: "Two",
        image_url: "/uploads/C:%2Fprivate%2Favatar.jpg",
        coverImage_url: "/uploads/%252e%252e%252fprivate.txt",
        country: "Egypt",
      },
    ],
    totalClients: 2,
  });
  const operations = createClientOperations({ clientModel });

  const result = await operations.listPublicProfiles({
    page: 1,
    limit: 20,
  });

  assert.deepEqual(
    result.clients.map(({ imageUrl, coverImageUrl }) => {
      return { imageUrl, coverImageUrl };
    }),
    [
      { imageUrl: null, coverImageUrl: null },
      { imageUrl: null, coverImageUrl: null },
    ],
  );
});

test("public Client Profile list accepts valid custom pagination", async () => {
  const calls = [];
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async (pagination) => {
        calls.push(pagination);
        return {
          clients: [],
          pagination: {
            ...pagination,
            totalClients: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    listPublicProfilesHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients?page=2&limit=100`,
    );

    assert.equal(response.status, 200);
  });

  assert.deepEqual(calls, [{ page: 2, limit: 100 }]);
});

test("public Client Profile list rejects invalid query shapes exactly", async () => {
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async () => {
        throw new Error("invalid input reached Client Operations");
      },
    },
    logger: { error: () => undefined },
  });
  const router = createClientsRouter({
    listPublicProfilesHandler: controller,
  });
  const invalidPaginationQueries = [
    "page=0",
    "page=-1",
    "page=1.5",
    "page=1.0",
    "page=abc",
    "page=",
    "page=1&page=2",
    "limit=0",
    "limit=101",
    "limit=1&limit=2",
  ];

  await withTestServer(router, async (baseUrl) => {
    for (const query of invalidPaginationQueries) {
      const response = await fetch(`${baseUrl}/api/v1/clients?${query}`);

      assert.equal(response.status, 400, query);
      assert.deepEqual(
        await response.json(),
        { message: "Invalid pagination parameters." },
        query,
      );
    }

    const unknownQueryResponse = await fetch(
      `${baseUrl}/api/v1/clients?sort=name`,
    );

    assert.equal(unknownQueryResponse.status, 400);
    assert.deepEqual(await unknownQueryResponse.json(), {
      message: "Invalid request.",
    });
  });
});

test("unexpected Client Profile list failures use the exact generic response", async () => {
  const loggedErrors = [];
  const databaseError = new Error("private MongoDB failure");
  const controller = createListPublicProfilesController({
    operations: {
      listPublicProfiles: async () => {
        throw databaseError;
      },
    },
    logger: {
      error: (...values) => {
        loggedErrors.push(values);
      },
    },
  });
  const router = createClientsRouter({
    listPublicProfilesHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/clients`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { message: "Internal server error." });
    assert.equal(Object.hasOwn(body, "success"), false);
    assert.equal(Object.hasOwn(body, "stack"), false);
  });

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][1], databaseError);
});

test("unexpected Client Profile lookup failures use the exact generic response", async () => {
  const loggedErrors = [];
  const databaseError = new Error("private MongoDB lookup failure");
  const controller = createGetPublicProfileByIdController({
    operations: {
      getPublicProfileById: async () => {
        throw databaseError;
      },
    },
    logger: {
      error: (...values) => {
        loggedErrors.push(values);
      },
    },
  });
  const router = createClientsRouter({
    getPublicProfileByIdHandler: controller,
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/${publicClientId}`,
    );
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { message: "Internal server error." });
    assert.equal(Object.hasOwn(body, "stack"), false);
  });

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][1], databaseError);
});

test("Client model declares the deterministic public-list index", () => {
  const publicListIndex = ClientModel.schema.indexes().find(([fields]) => {
    return fields.createdAt === -1 && fields._id === -1;
  });

  assert.ok(publicListIndex);
});

test("the legacy public Client list handler remains removed", async () => {
  const router = createClientsRouter({
    listPublicProfilesHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/getAllClients`,
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      message: "Client id must be a valid ObjectId.",
    });
  });
});

test("the legacy public Client Profile detail route is removed", async () => {
  const router = createClientsRouter({
    getPublicProfileByIdHandler: (_req, res) => {
      return res.status(200).json({ unexpected: true });
    },
  });

  await withTestServer(router, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/clients/getClientById/${publicClientId}`,
    );

    assert.equal(response.status, 404);
  });
});

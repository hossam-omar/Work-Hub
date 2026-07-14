import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapFirstAdmin,
  getBootstrapConfiguration,
} from "../src/modules/admin/adminBootstrap.js";
import { parseSaltRounds } from "../src/config/saltRounds.js";
import AdminModel from "../DB/models/admin_model.js";

const validEnvironment = () => ({
  CONNECTION_URL: " mongodb://localhost:27017/workhub-test ",
  INITIAL_ADMIN_NAME: "  Initial Admin  ",
  INITIAL_ADMIN_EMAIL: "  Initial.Admin@Example.COM  ",
  INITIAL_ADMIN_PASSWORD: "StrongPassword1!",
  SALT_ROUND: "12",
});

const createDependencies = (options = {}) => {
  const calls = {
    adminExists: [],
    indexPreparations: 0,
    clientExists: [],
    freelancerExists: [],
    hashes: [],
    creates: [],
  };

  const dependencies = {
    adminModel: {
      createIndexes: async () => {
        calls.indexPreparations += 1;
      },
      exists: async (filter) => {
        calls.adminExists.push(filter);

        return Object.keys(filter).length === 0
          ? Boolean(options.adminExists)
          : Boolean(options.adminEmailExists);
      },
      create: async (admin) => {
        calls.creates.push(admin);
        return { _id: "507f1f77bcf86cd799439011", email: admin.email };
      },
    },
    clientModel: {
      exists: async (filter) => {
        calls.clientExists.push(filter);
        return Boolean(options.clientEmailExists);
      },
    },
    freelancerModel: {
      exists: async (filter) => {
        calls.freelancerExists.push(filter);
        return Boolean(options.freelancerEmailExists);
      },
    },
    hashPassword: async (password, rounds) => {
      calls.hashes.push({ password, rounds });
      return "hashed-password";
    },
  };

  return { calls, dependencies };
};

test("Admin model declares the hidden unique bootstrap guard", () => {
  const bootstrapIndex = AdminModel.schema.indexes().find(([fields]) => {
    return fields.bootstrapKey === 1;
  });

  assert.ok(bootstrapIndex);
  assert.equal(bootstrapIndex[1].unique, true);
  assert.equal(bootstrapIndex[1].sparse, true);
  assert.equal(AdminModel.schema.path("bootstrapKey").options.select, false);
  assert.equal(AdminModel.schema.path("bootstrapKey").options.immutable, true);
});

test("bootstrap configuration requires every non-empty input", () => {
  for (const variableName of [
    "CONNECTION_URL",
    "INITIAL_ADMIN_NAME",
    "INITIAL_ADMIN_EMAIL",
    "INITIAL_ADMIN_PASSWORD",
  ]) {
    const environment = validEnvironment();
    environment[variableName] = "   ";

    assert.throws(
      () => getBootstrapConfiguration(environment),
      new RegExp(variableName),
    );
  }
});

test("bootstrap configuration uses Joi-normalized Admin values", () => {
  const configuration = getBootstrapConfiguration(validEnvironment());

  assert.equal(
    configuration.connectionUrl,
    "mongodb://localhost:27017/workhub-test",
  );
  assert.deepEqual(configuration.credentials, {
    name: "Initial Admin",
    email: "initial.admin@example.com",
    password: "StrongPassword1!",
  });
  assert.equal(configuration.saltRounds, 12);
});

test("invalid Admin values fail without echoing the password", () => {
  const invalidValues = [
    ["INITIAL_ADMIN_NAME", "x".repeat(101)],
    ["INITIAL_ADMIN_EMAIL", "not-an-email"],
    ["INITIAL_ADMIN_PASSWORD", "do-not-echo-this-password"],
  ];

  for (const [name, value] of invalidValues) {
    const environment = validEnvironment();
    environment[name] = value;

    assert.throws(
      () => getBootstrapConfiguration(environment),
      (error) => {
        assert.match(error.message, /Initial Admin validation failed/);
        assert.equal(error.message.includes(value), false);
        return true;
      },
    );
  }
});

test("salt rounds default only when omitted and reject invalid values", () => {
  assert.equal(parseSaltRounds(undefined), 10);
  assert.equal(parseSaltRounds("4"), 4);
  assert.equal(parseSaltRounds("15"), 15);

  for (const value of ["", "3", "16", "10.0", "10rounds", "010"]) {
    assert.throws(() => parseSaltRounds(value), /integer from 4 to 15/);

    const environment = validEnvironment();
    environment.SALT_ROUND = value;
    assert.throws(
      () => getBootstrapConfiguration(environment),
      /integer from 4 to 15/,
    );
  }
});

test("an existing Admin prevents hashing and creation", async () => {
  const configuration = getBootstrapConfiguration(validEnvironment());
  const { calls, dependencies } = createDependencies({ adminExists: true });

  await assert.rejects(
    () => bootstrapFirstAdmin(configuration, dependencies),
    /Admin account already exists/,
  );
  assert.equal(calls.hashes.length, 0);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.indexPreparations, 0);
  assert.equal(calls.clientExists.length, 0);
  assert.equal(calls.freelancerExists.length, 0);
});

test("an email used by a Client or Freelancer prevents creation", async (t) => {
  for (const accountType of ["client", "freelancer"]) {
    await t.test(accountType, async () => {
      const configuration = getBootstrapConfiguration(validEnvironment());
      const options = {
        [`${accountType}EmailExists`]: true,
      };
      const { calls, dependencies } = createDependencies(options);

      await assert.rejects(
        () => bootstrapFirstAdmin(configuration, dependencies),
        /email is already used/,
      );
      assert.equal(calls.hashes.length, 0);
      assert.equal(calls.creates.length, 0);
    });
  }
});

test("email checks are case-insensitive for legacy account data", async () => {
  const configuration = getBootstrapConfiguration(validEnvironment());
  const { calls, dependencies } = createDependencies({
    clientEmailExists: true,
  });

  await assert.rejects(
    () => bootstrapFirstAdmin(configuration, dependencies),
    /email is already used/,
  );

  const checkedEmail = calls.clientExists[0].email;
  assert.ok(checkedEmail instanceof RegExp);
  assert.equal(checkedEmail.test("Initial.Admin@Example.COM"), true);
});

test("valid credentials create one offline Admin without a token", async () => {
  const configuration = getBootstrapConfiguration(validEnvironment());
  const { calls, dependencies } = createDependencies();

  const result = await bootstrapFirstAdmin(configuration, dependencies);

  assert.deepEqual(calls.hashes, [
    { password: "StrongPassword1!", rounds: 12 },
  ]);
  assert.equal(calls.indexPreparations, 1);
  assert.deepEqual(calls.creates, [
    {
      name: "Initial Admin",
      email: "initial.admin@example.com",
      password: "hashed-password",
      role: "admin",
      activityStatus: "offline",
      bootstrapKey: "initial-admin",
    },
  ]);
  assert.equal(Object.hasOwn(calls.creates[0], "token"), false);
  assert.deepEqual(result, {
    id: "507f1f77bcf86cd799439011",
    email: "initial.admin@example.com",
  });
});

test("rerunning after successful creation writes no additional Admin", async () => {
  const configuration = getBootstrapConfiguration(validEnvironment());
  let adminExists = false;
  let createCount = 0;
  const dependencies = {
    adminModel: {
      createIndexes: async () => undefined,
      exists: async (filter) => {
        return Object.keys(filter).length === 0 ? adminExists : false;
      },
      create: async (admin) => {
        createCount += 1;
        adminExists = true;
        return { _id: "507f1f77bcf86cd799439011", email: admin.email };
      },
    },
    clientModel: { exists: async () => false },
    freelancerModel: { exists: async () => false },
    hashPassword: async () => "hashed-password",
  };

  await bootstrapFirstAdmin(configuration, dependencies);
  await assert.rejects(
    () => bootstrapFirstAdmin(configuration, dependencies),
    /Admin account already exists/,
  );
  assert.equal(createCount, 1);
});

test("the database bootstrap key allows only one concurrent creation", async () => {
  const firstConfiguration = getBootstrapConfiguration(validEnvironment());
  const secondEnvironment = validEnvironment();
  secondEnvironment.INITIAL_ADMIN_NAME = "Second Initial Admin";
  secondEnvironment.INITIAL_ADMIN_EMAIL = "second.admin@example.com";
  const secondConfiguration = getBootstrapConfiguration(secondEnvironment);
  const createdAdmins = [];
  let bootstrapIndexReady = false;
  let hashingStarted = 0;
  let releaseHashes;
  const hashesMayFinish = new Promise((resolve) => {
    releaseHashes = resolve;
  });
  let bothHashesStarted;
  const bothHashesHaveStarted = new Promise((resolve) => {
    bothHashesStarted = resolve;
  });
  const adminModel = {
    createIndexes: async () => {
      bootstrapIndexReady = true;
    },
    exists: async (filter) => {
      if (Object.keys(filter).length === 0) {
        return createdAdmins.length > 0;
      }

      return false;
    },
    create: async (admin) => {
      if (
        bootstrapIndexReady &&
        createdAdmins.some(
          (createdAdmin) =>
            createdAdmin.bootstrapKey === admin.bootstrapKey,
        )
      ) {
        const error = new Error("duplicate bootstrap key");
        error.code = 11000;
        error.keyPattern = { bootstrapKey: 1 };
        throw error;
      }

      createdAdmins.push(admin);
      return {
        _id: `507f1f77bcf86cd79943901${createdAdmins.length}`,
        email: admin.email,
      };
    },
  };
  const dependencies = {
    adminModel,
    clientModel: { exists: async () => false },
    freelancerModel: { exists: async () => false },
    hashPassword: async () => {
      hashingStarted += 1;
      if (hashingStarted === 2) bothHashesStarted();
      await hashesMayFinish;
      return "hashed-password";
    },
  };

  const attempts = [
    bootstrapFirstAdmin(firstConfiguration, dependencies),
    bootstrapFirstAdmin(secondConfiguration, dependencies),
  ];
  await bothHashesHaveStarted;
  releaseHashes();
  const results = await Promise.allSettled(attempts);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.match(
    results.find(({ status }) => status === "rejected").reason.message,
    /Another bootstrap command created the first Admin/,
  );
  assert.equal(createdAdmins.length, 1);
});

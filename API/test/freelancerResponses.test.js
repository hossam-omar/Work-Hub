import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import FreelancerModel from "../DB/models/freelancer_model.js";
import AdminModel from "../DB/models/admin_model.js";
import ClientModel from "../DB/models/client_model.js";
import login, { signup } from "../src/modules/auth/authController.js";
import {
  getAllFreelancers,
  getFreelancerById,
  updateFreelancerInfo,
} from "../src/modules/freelancer/freelancerController.js";
import {
  authenticatedFreelancerProjection,
  freelancerAuthenticationProjection,
  freelancerIdentityProjection,
  publicFreelancerProjection,
} from "../src/modules/freelancer/freelancerRepresentations.js";

const freelancerId = "507f1f77bcf86cd799439011";

const freelancer = {
  _id: freelancerId,
  name: "Grace Hopper",
  email: "grace@example.com",
  phoneNumber: "01234567890",
  image_url: "avatar.jpg",
  coverImage_url: "cover.jpg",
  country: "Egypt",
  desc: "Backend engineer",
  activityStatus: "online",
  lastLogin: new Date("2026-09-09T12:00:00.000Z"),
  languages: ["English"],
  skills: ["Node.js"],
  servicesCount: 3,
  specialization: "Backend",
  role: "freelancer",
  password: "private-password-hash",
  token: "private-auth-token",
  futureInternalField: "must-not-leak",
};

const createResponse = () => {
  const response = { statusCode: null, body: null };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  response.send = response.json;
  return response;
};

const assertNoSensitiveFields = (body) => {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("private-"), false);
  assert.equal(serialized.includes("must-not-leak"), false);
};

test("public Freelancer list and detail preserve their envelopes without leaking stored fields", async (t) => {
  const originalFind = FreelancerModel.find;
  const originalFindById = FreelancerModel.findById;
  const calls = { find: [], findById: [] };
  FreelancerModel.find = (filter, projection) => {
    calls.find.push({ filter, projection });
    return [freelancer, null];
  };
  FreelancerModel.findById = (id, projection) => {
    calls.findById.push({ id, projection });
    return freelancer;
  };
  t.after(() => {
    FreelancerModel.find = originalFind;
    FreelancerModel.findById = originalFindById;
  });

  const listResponse = createResponse();
  await getAllFreelancers({ hostname: "api.test" }, listResponse);
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(calls.find, [{ filter: {}, projection: publicFreelancerProjection }]);
  assert.deepEqual(listResponse.body.freelancers, [{
    ...Object.fromEntries(Object.entries(freelancer).filter(([key]) => !["password", "token", "lastLogin", "futureInternalField"].includes(key))),
    image_url: "http://api.test:3000/uploads/avatar.jpg",
    coverImage_url: "http://api.test:3000/uploads/cover.jpg",
  }]);
  assertNoSensitiveFields(listResponse.body);

  const detailResponse = createResponse();
  await getFreelancerById({ params: { id: freelancerId }, hostname: "api.test" }, detailResponse);
  assert.equal(detailResponse.statusCode, 200);
  assert.deepEqual(calls.findById, [{ id: freelancerId, projection: publicFreelancerProjection }]);
  assert.equal(detailResponse.body.freelancer.image_url, "http://api.test:3000/uploads/avatar.jpg");
  assert.equal(detailResponse.body.freelancer.coverImage_url, "http://api.test:3000/uploads/cover.jpg");
  assertNoSensitiveFields(detailResponse.body);
});

test("Freelancer profile update preserves freelancerNewData while serializing the self profile", async (t) => {
  const originalFindById = FreelancerModel.findById;
  const originalFind = FreelancerModel.find;
  const originalUpdateOne = FreelancerModel.updateOne;
  const calls = { findById: [], find: [], updateOne: [] };
  FreelancerModel.findById = (id, projection) => {
    calls.findById.push({ id, projection });
    return freelancer;
  };
  FreelancerModel.find = (filter, projection) => {
    calls.find.push({ filter, projection });
    return [];
  };
  FreelancerModel.updateOne = async (filter, update) => {
    calls.updateOne.push({ filter, update });
  };
  t.after(() => {
    FreelancerModel.findById = originalFindById;
    FreelancerModel.find = originalFind;
    FreelancerModel.updateOne = originalUpdateOne;
  });

  const response = createResponse();
  await updateFreelancerInfo({
    params: { id: freelancerId },
    hostname: "api.test",
    body: {
      name: freelancer.name,
      email: freelancer.email,
      phoneNumber: freelancer.phoneNumber,
      desc: freelancer.desc,
      country: freelancer.country,
      skills: freelancer.skills,
      languages: freelancer.languages,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.findById, [
    { id: freelancerId, projection: authenticatedFreelancerProjection },
    { id: freelancerId, projection: authenticatedFreelancerProjection },
  ]);
  assert.deepEqual(calls.find, [{ filter: { email: freelancer.email }, projection: freelancerIdentityProjection }]);
  assert.equal(response.body.msg, "Freelancer has been updated successfuly.");
  assert.equal(response.body.freelancerNewData.lastLogin, freelancer.lastLogin);
  assert.equal(response.body.freelancerNewData.image_url, "http://api.test:3000/uploads/avatar.jpg");
  assertNoSensitiveFields(response.body);
});

test("Freelancer sign-in and sign-up preserve the auth envelope with only the self profile", async (t) => {
  const originalTokenSecret = process.env.TOKEN_SECRETkEY;
  process.env.TOKEN_SECRETkEY = "test-token-secret";
  const originals = {
    adminFindOne: AdminModel.findOne,
    clientFindOne: ClientModel.findOne,
    freelancerFindOne: FreelancerModel.findOne,
    freelancerFindById: FreelancerModel.findById,
    freelancerUpdateOne: FreelancerModel.updateOne,
    freelancerSave: FreelancerModel.prototype.save,
  };
  const calls = { findOne: [], findById: [] };
  const password = "Password1";
  const passwordHash = await bcrypt.hash(password, 10);
  const storedAuthFreelancer = { ...freelancer, password: passwordHash };
  let savedFreelancer;
  let signupMode = false;
  const noUser = () => ({ select: async () => null });
  AdminModel.findOne = noUser;
  ClientModel.findOne = noUser;
  FreelancerModel.findOne = (filter, projection) => {
    calls.findOne.push({ filter, projection });
    return {
      select: async () =>
        signupMode && !savedFreelancer
          ? null
          : savedFreelancer ?? storedAuthFreelancer,
    };
  };
  FreelancerModel.findById = (id, projection) => {
    calls.findById.push({ id, projection });
    return storedAuthFreelancer;
  };
  FreelancerModel.updateOne = async () => ({ matchedCount: 1 });
  FreelancerModel.prototype.save = async function save() {
    savedFreelancer = { ...storedAuthFreelancer, ...this.toObject() };
    return this;
  };
  t.after(() => {
    if (originalTokenSecret === undefined) {
      delete process.env.TOKEN_SECRETkEY;
    } else {
      process.env.TOKEN_SECRETkEY = originalTokenSecret;
    }
    AdminModel.findOne = originals.adminFindOne;
    ClientModel.findOne = originals.clientFindOne;
    FreelancerModel.findOne = originals.freelancerFindOne;
    FreelancerModel.findById = originals.freelancerFindById;
    FreelancerModel.updateOne = originals.freelancerUpdateOne;
    FreelancerModel.prototype.save = originals.freelancerSave;
  });

  const loginResponse = createResponse();
  await login({ body: { email: freelancer.email, password }, protocol: "http", get: () => "api.test" }, loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.message, "Sign in successful");
  assertNoSensitiveFields(loginResponse.body.user);
  assert.equal(loginResponse.body.user.lastLogin, freelancer.lastLogin);
  assert.deepEqual(calls.findById, [{ id: freelancerId, projection: authenticatedFreelancerProjection }]);

  savedFreelancer = null;
  signupMode = true;
  const signupResponse = createResponse();
  await signup({
    params: { role: "freelancer" },
    body: {
      name: freelancer.name,
      email: freelancer.email,
      password,
      country: freelancer.country,
      desc: freelancer.desc,
      phoneNumber: freelancer.phoneNumber,
      skills: freelancer.skills,
      languages: freelancer.languages,
      specialization: freelancer.specialization,
    },
    protocol: "http",
    get: () => "api.test",
  }, signupResponse);
  assert.equal(signupResponse.statusCode, 201);
  assert.equal(signupResponse.body.message, "User created successfully");
  assertNoSensitiveFields(signupResponse.body.user);
  assert.deepEqual(calls.findOne.at(-1), {
    filter: { email: freelancer.email },
    projection: freelancerAuthenticationProjection,
  });

  const legacyFreelancer = {
    ...storedAuthFreelancer,
    role: undefined,
    futureInternalField: "legacy-field-must-not-leak",
  };
  FreelancerModel.findOne = (filter, projection) => {
    calls.findOne.push({ filter, projection });
    return { select: async () => legacyFreelancer };
  };
  FreelancerModel.findById = () => legacyFreelancer;
  const legacyLoginResponse = createResponse();
  await login({ body: { email: freelancer.email, password }, protocol: "http", get: () => "api.test" }, legacyLoginResponse);
  assert.equal(legacyLoginResponse.statusCode, 200);
  assert.equal(JSON.stringify(legacyLoginResponse.body.user).includes("legacy-field-must-not-leak"), false);
  assert.equal(JSON.stringify(legacyLoginResponse.body.user).includes("private-"), false);
});

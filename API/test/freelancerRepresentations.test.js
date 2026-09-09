import test from "node:test";
import assert from "node:assert/strict";
import {
  toAuthenticatedFreelancer,
  toPublicFreelancer,
} from "../src/modules/freelancer/freelancerRepresentations.js";

const storedFreelancer = {
  _id: { toString: () => "507f1f77bcf86cd799439011" },
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
  __v: 2,
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-09T12:00:00.000Z"),
  futureInternalField: "must-not-leak",
};

test("public Freelancer serialization exposes only the MVP public contract", () => {
  assert.deepEqual(toPublicFreelancer(storedFreelancer, {
    buildUploadUrl: (reference) => `http://api.test:3000/uploads/${reference}`,
  }), {
    _id: storedFreelancer._id,
    name: "Grace Hopper",
    email: "grace@example.com",
    phoneNumber: "01234567890",
    image_url: "http://api.test:3000/uploads/avatar.jpg",
    coverImage_url: "http://api.test:3000/uploads/cover.jpg",
    country: "Egypt",
    desc: "Backend engineer",
    activityStatus: "online",
    languages: ["English"],
    skills: ["Node.js"],
    servicesCount: 3,
    specialization: "Backend",
    role: "freelancer",
  });
});

test("authenticated Freelancer serialization has an explicit self-only contract", () => {
  const response = toAuthenticatedFreelancer(storedFreelancer, {
    buildUploadUrl: (reference) => `http://api.test/uploads/${reference}`,
  });

  assert.deepEqual(response, {
    _id: storedFreelancer._id,
    name: "Grace Hopper",
    email: "grace@example.com",
    phoneNumber: "01234567890",
    image_url: "http://api.test/uploads/avatar.jpg",
    coverImage_url: "http://api.test/uploads/cover.jpg",
    country: "Egypt",
    desc: "Backend engineer",
    activityStatus: "online",
    lastLogin: storedFreelancer.lastLogin,
    languages: ["English"],
    skills: ["Node.js"],
    servicesCount: 3,
    specialization: "Backend",
    role: "freelancer",
  });
  assert.equal(JSON.stringify(response).includes("private-"), false);
  assert.equal(JSON.stringify(response).includes("must-not-leak"), false);
});

test("Freelancer serialization safely rejects missing and malformed records", () => {
  assert.equal(toPublicFreelancer(null), null);
  assert.equal(toAuthenticatedFreelancer("malformed"), null);
  assert.deepEqual(toPublicFreelancer({ name: "Legacy" }), {
    _id: undefined,
    name: "Legacy",
    email: undefined,
    phoneNumber: undefined,
    image_url: undefined,
    coverImage_url: undefined,
    country: undefined,
    desc: undefined,
    activityStatus: undefined,
    languages: undefined,
    skills: undefined,
    servicesCount: undefined,
    specialization: undefined,
    role: undefined,
  });
});

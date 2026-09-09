const publicFreelancerFields = [
  "_id",
  "name",
  "email",
  "phoneNumber",
  "image_url",
  "coverImage_url",
  "country",
  "desc",
  "activityStatus",
  "languages",
  "skills",
  "servicesCount",
  "specialization",
  "role",
];

const authenticatedFreelancerFields = [
  "_id",
  "name",
  "email",
  "phoneNumber",
  "image_url",
  "coverImage_url",
  "country",
  "desc",
  "activityStatus",
  "lastLogin",
  "languages",
  "skills",
  "servicesCount",
  "specialization",
  "role",
];

const toProjection = (fields) =>
  Object.freeze(Object.fromEntries(fields.map((field) => [field, 1])));

export const publicFreelancerProjection = toProjection(publicFreelancerFields);
export const authenticatedFreelancerProjection = toProjection(
  authenticatedFreelancerFields,
);
export const freelancerAuthenticationProjection = Object.freeze({
  ...authenticatedFreelancerProjection,
  password: 1,
});
export const freelancerIdentityProjection = Object.freeze({ _id: 1, email: 1 });

const toPlainRecord = (record) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  try {
    const plainRecord = record.toObject ? record.toObject() : record;

    return plainRecord && typeof plainRecord === "object" && !Array.isArray(plainRecord)
      ? plainRecord
      : null;
  } catch {
    return null;
  }
};

const serializeFreelancer = (record, fields, { buildUploadUrl } = {}) => {
  const source = toPlainRecord(record);
  if (!source) return null;

  const response = Object.fromEntries(
    fields.map((field) => [field, source[field]]),
  );

  if (typeof buildUploadUrl === "function") {
    for (const field of ["image_url", "coverImage_url"]) {
      if (response[field] !== undefined && response[field] !== null) {
        response[field] = buildUploadUrl(response[field]);
      }
    }
  }

  return response;
};

export const toPublicFreelancer = (record, options) =>
  serializeFreelancer(record, publicFreelancerFields, options);

export const toAuthenticatedFreelancer = (record, options) =>
  serializeFreelancer(record, authenticatedFreelancerFields, options);

export class ClientError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const invalidClientRequest = () => {
  return new ClientError("INVALID_REQUEST", 400, "Invalid request.");
};

export const invalidClientPagination = () => {
  return new ClientError(
    "INVALID_PAGINATION",
    400,
    "Invalid pagination parameters.",
  );
};

export const invalidClientId = () => {
  return new ClientError(
    "INVALID_CLIENT_ID",
    400,
    "Client id must be a valid ObjectId.",
  );
};

export const clientProfileNotFound = () => {
  return new ClientError(
    "CLIENT_PROFILE_NOT_FOUND",
    404,
    "Client profile not found.",
  );
};

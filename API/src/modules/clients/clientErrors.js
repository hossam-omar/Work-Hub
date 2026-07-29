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

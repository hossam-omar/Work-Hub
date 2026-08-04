export class ClientError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ClientValidationError extends ClientError {
  constructor(errors) {
    super("CLIENT_VALIDATION_FAILED", 400, "Validation failed.");
    this.name = "ClientValidationError";
    this.errors = errors;
  }
}

export const invalidClientRequest = () => {
  return new ClientError("INVALID_REQUEST", 400, "Invalid request.");
};

export const invalidClientProfileValues = (errors) => {
  return new ClientValidationError(errors);
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

export const unsupportedClientMediaType = () => {
  return new ClientError(
    "UNSUPPORTED_MEDIA_TYPE",
    415,
    "Unsupported media type.",
  );
};

export const clientPasswordConfirmationMismatch = () => {
  return new ClientError(
    "PASSWORD_CONFIRMATION_MISMATCH",
    400,
    "Password confirmation does not match.",
  );
};

export const invalidNewClientPassword = () => {
  return new ClientError(
    "INVALID_NEW_PASSWORD",
    400,
    "New password does not meet requirements.",
  );
};

export const incorrectCurrentClientPassword = () => {
  return new ClientError(
    "INCORRECT_CURRENT_PASSWORD",
    400,
    "Current password is incorrect.",
  );
};

export const reusedCurrentClientPassword = () => {
  return new ClientError(
    "REUSED_CURRENT_PASSWORD",
    400,
    "New password must be different from current password.",
  );
};

export const clientAccountNotFound = () => {
  return new ClientError(
    "CLIENT_ACCOUNT_NOT_FOUND",
    404,
    "Client account not found.",
  );
};

export const clientPasswordChangeConflict = () => {
  return new ClientError(
    "PASSWORD_CHANGE_CONFLICT",
    409,
    "Password was changed by another request. Please sign in again.",
  );
};

export const clientEmailConflict = () => {
  return new ClientError(
    "CLIENT_EMAIL_CONFLICT",
    409,
    "Email is already in use.",
  );
};

export const invalidClientImage = () => {
  return new ClientError(
    "INVALID_CLIENT_IMAGE",
    400,
    "Invalid image file.",
  );
};

export const clientImagePayloadTooLarge = () => {
  return new ClientError(
    "CLIENT_IMAGE_PAYLOAD_TOO_LARGE",
    413,
    "Payload too large.",
  );
};

export const clientProfileChangeConflict = () => {
  return new ClientError(
    "CLIENT_PROFILE_CHANGE_CONFLICT",
    409,
    "Client profile changed; please retry.",
  );
};

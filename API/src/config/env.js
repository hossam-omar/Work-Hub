import dotenv from "dotenv";

dotenv.config();

const requireNonEmptyEnv = (name) => {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const validateOptionalIntegerRangeEnv = (name, minValue, maxValue) => {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") return;

  const parsedValue = Number.parseInt(value, 10);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < minValue ||
    parsedValue > maxValue ||
    String(parsedValue) !== value.trim()
  ) {
    throw new Error(
      `${name} must be an integer from ${minValue} to ${maxValue} when provided`,
    );
  }
};

requireNonEmptyEnv("TOKEN_SECRETkEY");
validateOptionalIntegerRangeEnv("SALT_ROUND", 4, 15);

export const env = {
  port: process.env.PORT || 3000,
};

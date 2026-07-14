export const DEFAULT_SALT_ROUNDS = 10;
export const MIN_SALT_ROUNDS = 4;
export const MAX_SALT_ROUNDS = 15;

export const parseSaltRounds = (value) => {
  if (value === undefined) {
    return DEFAULT_SALT_ROUNDS;
  }

  const normalizedValue = String(value).trim();
  const parsedValue = Number(normalizedValue);

  if (
    !/^\d+$/.test(normalizedValue) ||
    !Number.isInteger(parsedValue) ||
    parsedValue < MIN_SALT_ROUNDS ||
    parsedValue > MAX_SALT_ROUNDS ||
    String(parsedValue) !== normalizedValue
  ) {
    throw new Error(
      `SALT_ROUND must be an integer from ${MIN_SALT_ROUNDS} to ${MAX_SALT_ROUNDS} when provided`,
    );
  }

  return parsedValue;
};

export const getSaltRounds = () => parseSaltRounds(process.env.SALT_ROUND);

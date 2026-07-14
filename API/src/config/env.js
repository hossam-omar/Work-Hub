import dotenv from "dotenv";
import { getSaltRounds } from "./saltRounds.js";

dotenv.config();

const requireNonEmptyEnv = (name) => {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

requireNonEmptyEnv("TOKEN_SECRETkEY");
getSaltRounds();

export const env = {
  port: process.env.PORT || 3000,
};

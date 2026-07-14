import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import {
  AdminBootstrapError,
  bootstrapFirstAdmin,
  getBootstrapConfiguration,
} from "../src/modules/admin/adminBootstrap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const environmentFile = path.resolve(__dirname, "../.env");

const run = async () => {
  try {
    dotenv.config({ path: environmentFile });
    const configuration = getBootstrapConfiguration(process.env);

    try {
      await mongoose.connect(configuration.connectionUrl);
    } catch {
      throw new AdminBootstrapError(
        "Unable to connect to MongoDB; verify CONNECTION_URL and database availability",
      );
    }

    const createdAdmin = await bootstrapFirstAdmin(configuration);

    console.log(
      `Initial Admin created successfully (ID: ${createdAdmin.id}, email: ${createdAdmin.email})`,
    );
  } catch (error) {
    const message =
      error instanceof AdminBootstrapError
        ? error.message
        : "The bootstrap command failed unexpectedly";

    console.error(`Admin bootstrap failed: ${message}`);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      console.error("Admin bootstrap failed to close the MongoDB connection");
      process.exitCode = 1;
    }
  }
};

await run();

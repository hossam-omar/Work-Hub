import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./src/routes/index.js";
import { errorHandler } from "./src/middleware/error.middleware.js";
import { notFoundHandler } from "./src/middleware/not-found.middleware.js";
import {
  handleClientPasswordRequestParseError,
} from "./src/modules/clients/clientRequest.middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "uploads");

const app = express();

app.use(
  cors({
    origin: "*",//TODO: Change this to the actual frontend URL in production
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(handleClientPasswordRequestParseError);

registerRoutes(app);
app.use("/uploads", express.static(uploadsDir));
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

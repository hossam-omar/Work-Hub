import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const mongoConnectionStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

const getMongoStatus = () => ({
  status: mongoConnectionStates[mongoose.connection.readyState] || "unknown",
});

router.get("/", (req, res) => {
  const mongo = getMongoStatus();
  const isHealthy = mongo.status === "connected";

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    mongo,
  });
});

export default router;

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import healthRoutes from "../src/modules/health/healthRoutes.js";

test("health readiness and response contract depend only on MongoDB", async () => {
  let readyState = 0;
  const originalState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  Object.defineProperty(mongoose.connection, "readyState", {
    configurable: true,
    get: () => readyState,
  });
  const app = express();
  app.use("/api/health", healthRoutes);
  const server = app.listen(0);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const [state, status] of [
      [0, "disconnected"],
      [1, "connected"],
      [2, "connecting"],
      [3, "disconnecting"],
      [99, "unknown"],
    ]) {
      readyState = state;
      const response = await fetch(`${baseUrl}/api/health`);
      const body = await response.json();
      const isHealthy = state === 1;

      assert.equal(response.status, isHealthy ? 200 : 503);
      assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
      assert.deepEqual(body, {
        status: isHealthy ? "ok" : "degraded",
        environment: process.env.NODE_ENV || "development",
        timestamp: body.timestamp,
        mongo: { status },
      });
    }
  } finally {
    if (originalState) {
      Object.defineProperty(mongoose.connection, "readyState", originalState);
    } else {
      delete mongoose.connection.readyState;
    }
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

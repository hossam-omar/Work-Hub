import test from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const withServer = async (operation) => {
  const server = app.listen(0);

  try {
    const address = server.address();
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
};

test("every request receives a unique server-generated request identifier", async () => {
  await withServer(async (baseUrl) => {
    const suppliedId = "caller-controlled-request-id";
    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`${baseUrl}/request-context-one`, {
        headers: { "x-request-id": suppliedId },
      }),
      fetch(`${baseUrl}/request-context-two`, {
        headers: { "x-request-id": suppliedId },
      }),
    ]);

    const firstId = firstResponse.headers.get("x-request-id");
    const secondId = secondResponse.headers.get("x-request-id");

    assert.match(firstId, requestIdPattern);
    assert.match(secondId, requestIdPattern);
    assert.notEqual(firstId, secondId);
    assert.notEqual(firstId, suppliedId);
    assert.notEqual(secondId, suppliedId);
    assert.equal(firstResponse.status, 404);
    assert.deepEqual(await firstResponse.json(), {
      success: false,
      message: "Page Not Found",
    });
  });
});

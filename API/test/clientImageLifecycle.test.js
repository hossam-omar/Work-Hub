import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import {
  CLIENT_IMAGE_ERROR_CATEGORIES,
  CLIENT_IMAGE_CLEANUP_OUTCOMES,
  CLIENT_IMAGE_REFERENCE_CATEGORIES,
  CLIENT_IMAGE_RESULT_CATEGORIES,
  ClientImageLifecycleError,
  createClientImageLifecycle,
} from "../src/modules/clients/clientImageLifecycle.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

const unsigned32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};

const pngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type);
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) {
    checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }

  return Buffer.concat([
    unsigned32(data.length),
    typeBuffer,
    data,
    unsigned32((checksum ^ 0xffffffff) >>> 0),
  ]);
};

const createAnimatedPng = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;

  const frameControl = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(1, 4);
    data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return data;
  };

  const firstFrame = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const secondFrame = deflateSync(Buffer.from([0, 0, 0, 255, 255]));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("acTL", Buffer.concat([unsigned32(2), unsigned32(0)])),
    pngChunk("fcTL", frameControl(0)),
    pngChunk("IDAT", firstFrame),
    pngChunk("fcTL", frameControl(1)),
    pngChunk("fdAT", Buffer.concat([unsigned32(2), secondFrame])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const createAnimatedWebp = async () => {
  const firstFrame = await createImage({ format: "png", width: 8, height: 8 });
  const secondFrame = await createImage({
    format: "png",
    width: 8,
    height: 8,
    background: { r: 200, g: 40, b: 20, alpha: 1 },
  });
  return sharp([firstFrame, secondFrame], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
};

const createImage = ({
  format,
  width = 32,
  height = 24,
  background = { r: 25, g: 100, b: 180, alpha: 0.8 },
}) => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  });

  return image[format]().toBuffer();
};

const withLifecycle = async (operation, options = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-hub-client-image-"));
  const stagingRoot = path.join(root, "private-staging");
  const uploadsRoot = path.join(root, "uploads");
  await Promise.all([
    mkdir(stagingRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);

  const lifecycle = createClientImageLifecycle({
    stagingRoot,
    uploadsRoot,
    ...options,
  });

  try {
    await operation({ lifecycle, root, stagingRoot, uploadsRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const assertLifecycleError = async (operation, expectedCategory) => {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ClientImageLifecycleError);
    assert.equal(error.category, expectedCategory);
    return true;
  });
};

test("stages an opaque PNG handle and promotes a sanitized managed image", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot, uploadsRoot }) => {
    const source = await createImage({ format: "png" });
    const handle = await lifecycle.stageUpload({
      stream: Readable.from(source),
      originalName: "avatar.png",
      mimeType: "image/png",
    });

    assert.deepEqual(Object.keys(handle), []);
    assert.equal(JSON.stringify(handle), "{}");
    assert.equal((await readdir(stagingRoot)).length, 1);
    assert.deepEqual(await readdir(uploadsRoot), []);

    const result = await lifecycle.processAndPromote(handle);

    assert.equal(result.category, CLIENT_IMAGE_RESULT_CATEGORIES.PROMOTED);
    assert.match(result.reference, /^\/uploads\/client-[a-f0-9]{48}\.png$/);

    const output = await readFile(
      path.join(uploadsRoot, path.basename(result.reference)),
    );
    const metadata = await sharp(output).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 32);
    assert.equal(metadata.height, 24);
    assert.deepEqual(await readdir(stagingRoot), []);
  });
});

for (const input of [
  { format: "jpeg", originalName: "portrait.jpeg", mimeType: "image/jpeg" },
  { format: "jpeg", originalName: "portrait.JPG", mimeType: "image/jpeg" },
  { format: "webp", originalName: "portrait.webp", mimeType: "image/webp" },
]) {
  test(`re-encodes ${input.originalName} without changing its decoded format`, async () => {
    await withLifecycle(async ({ lifecycle, uploadsRoot }) => {
      const handle = await lifecycle.stageUpload({
        stream: Readable.from(await createImage({ format: input.format })),
        originalName: input.originalName,
        mimeType: input.mimeType,
      });

      const result = await lifecycle.processAndPromote(handle);
      const output = await readFile(
        path.join(uploadsRoot, path.basename(result.reference)),
      );

      assert.match(
        result.reference,
        new RegExp(
          `^/uploads/client-[a-f0-9]{48}\\.${input.format === "jpeg" ? "jpg" : "webp"}$`,
        ),
      );
      assert.equal((await sharp(output).metadata()).format, input.format);
    });
  });
}

test("rejects unsupported, multiple, and unsafe filename extensions before staging", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot }) => {
    for (const originalName of [
      "avatar.gif",
      "avatar.png.exe",
      "avatar.profile.png",
      "../avatar.png",
      "folder/avatar.png",
      "folder\\avatar.png",
      ".png",
      "avatar name.png",
      "avatar",
    ]) {
      await assertLifecycleError(
        () =>
          lifecycle.stageUpload({
            stream: Readable.from(Buffer.from("unused")),
            originalName,
            mimeType: "image/png",
          }),
        CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
      );
    }

    assert.deepEqual(await readdir(stagingRoot), []);
  });
});

test("requires the declared MIME type, final extension, signature, and decoder to agree", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot, uploadsRoot }) => {
    const jpeg = await createImage({ format: "jpeg" });

    await assertLifecycleError(
      () =>
        lifecycle.stageUpload({
          stream: Readable.from(jpeg),
          originalName: "avatar.jpg",
          mimeType: "image/png",
        }),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
    );

    const handle = await lifecycle.stageUpload({
      stream: Readable.from(jpeg),
      originalName: "avatar.png",
      mimeType: "image/png",
    });
    await assertLifecycleError(
      () => lifecycle.processAndPromote(handle),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
    );

    assert.deepEqual(await readdir(stagingRoot), []);
    assert.deepEqual(await readdir(uploadsRoot), []);
  });
});

test("accepts exactly 5 MiB in transport but removes a partial upload above the limit", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot }) => {
    const exactHandle = await lifecycle.stageUpload({
      stream: Readable.from(Buffer.alloc(MAX_IMAGE_BYTES)),
      originalName: "exact.png",
      mimeType: "image/png",
    });
    await assertLifecycleError(
      () => lifecycle.processAndPromote(exactHandle),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
    );

    await assertLifecycleError(
      () =>
        lifecycle.stageUpload({
          stream: Readable.from([
            Buffer.alloc(MAX_IMAGE_BYTES),
            Buffer.from([0]),
          ]),
          originalName: "large.png",
          mimeType: "image/png",
        }),
      CLIENT_IMAGE_ERROR_CATEGORIES.TRANSPORT_SIZE_EXCEEDED,
    );

    assert.deepEqual(await readdir(stagingRoot), []);
  });
});

test("requires a full decode and removes truncated image staging", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot, uploadsRoot }) => {
    const jpeg = await createImage({ format: "jpeg", width: 256, height: 256 });
    const handle = await lifecycle.stageUpload({
      stream: Readable.from(jpeg.subarray(0, Math.floor(jpeg.length / 2))),
      originalName: "truncated.jpg",
      mimeType: "image/jpeg",
    });

    await assertLifecycleError(
      () => lifecycle.processAndPromote(handle),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
    assert.deepEqual(await readdir(uploadsRoot), []);
  });
});

test("rejects either decoded dimension above 4096 pixels", async () => {
  for (const dimensions of [
    { width: 4097, height: 1 },
    { width: 1, height: 4097 },
  ]) {
    await withLifecycle(async ({ lifecycle, uploadsRoot }) => {
      const handle = await lifecycle.stageUpload({
        stream: Readable.from(
          await createImage({ format: "png", ...dimensions }),
        ),
        originalName: "oversized-dimensions.png",
        mimeType: "image/png",
      });

      await assertLifecycleError(
        () => lifecycle.processAndPromote(handle),
        CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
      );
      assert.deepEqual(await readdir(uploadsRoot), []);
    });
  }
});

test("rejects animated or multi-frame PNG and WebP images", async () => {
  for (const input of [
    {
      bytes: createAnimatedPng(),
      originalName: "animated.png",
      mimeType: "image/png",
    },
    {
      bytes: await createAnimatedWebp(),
      originalName: "animated.webp",
      mimeType: "image/webp",
    },
  ]) {
    await withLifecycle(async ({ lifecycle, stagingRoot, uploadsRoot }) => {
      const handle = await lifecycle.stageUpload({
        stream: Readable.from(input.bytes),
        originalName: input.originalName,
        mimeType: input.mimeType,
      });

      await assertLifecycleError(
        () => lifecycle.processAndPromote(handle),
        CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE,
      );
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    });
  }
});

test("auto-orients while stripping metadata and trailing payload", async () => {
  await withLifecycle(async ({ lifecycle, uploadsRoot }) => {
    const source = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: "#804020",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const trailingPayload = Buffer.from("private-token=must-not-survive");
    const handle = await lifecycle.stageUpload({
      stream: Readable.from(Buffer.concat([source, trailingPayload])),
      originalName: "oriented.jpg",
      mimeType: "image/jpeg",
    });

    const result = await lifecycle.processAndPromote(handle);
    const output = await readFile(
      path.join(uploadsRoot, path.basename(result.reference)),
    );
    const metadata = await sharp(output).metadata();

    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(output.includes(trailingPayload), false);
  });
});

test("removes processed staging and fails when re-encoded output exceeds 5 MiB", async () => {
  await withLifecycle(
    async ({ lifecycle, stagingRoot, uploadsRoot }) => {
      const handle = await lifecycle.stageUpload({
        stream: Readable.from(await createImage({ format: "png" })),
        originalName: "avatar.png",
        mimeType: "image/png",
      });

      await assertLifecycleError(
        () => lifecycle.processAndPromote(handle),
        CLIENT_IMAGE_ERROR_CATEGORIES.PROCESSED_SIZE_EXCEEDED,
      );
      assert.deepEqual(await readdir(stagingRoot), []);
      assert.deepEqual(await readdir(uploadsRoot), []);
    },
    {
      statFn: async (target) => {
        const information = await stat(target);
        if (path.basename(target).startsWith("processed.")) {
          return { dev: information.dev, size: MAX_IMAGE_BYTES + 1 };
        }
        return information;
      },
    },
  );
});

test("fails before staging when private and public roots are on different filesystems", async () => {
  await withLifecycle(
    async ({ lifecycle, stagingRoot }) => {
      const source = await createImage({ format: "png" });
      await assertLifecycleError(
        () =>
          lifecycle.stageUpload({
            stream: Readable.from(source),
            originalName: "avatar.png",
            mimeType: "image/png",
          }),
        CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE,
      );
      assert.deepEqual(await readdir(stagingRoot), []);
    },
    {
      statFn: async (target) => ({
        dev: path.basename(target) === "private-staging" ? 1 : 2,
        size: 0,
      }),
    },
  );
});

test("uses one same-filesystem rename from private processing to public uploads", async () => {
  const calls = [];
  await withLifecycle(
    async ({ lifecycle, stagingRoot, uploadsRoot }) => {
      const handle = await lifecycle.stageUpload({
        stream: Readable.from(await createImage({ format: "png" })),
        originalName: "avatar.png",
        mimeType: "image/png",
      });

      await lifecycle.processAndPromote(handle);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].source.startsWith(`${stagingRoot}${path.sep}`), true);
      assert.equal(path.dirname(calls[0].destination), uploadsRoot);
    },
    {
      renameFn: async (source, destination) => {
        calls.push({ source, destination });
        await rename(source, destination);
      },
    },
  );
});

test("creates unpredictable references and rejects reused or foreign handles", async () => {
  await withLifecycle(async ({ lifecycle }) => {
    const stage = async () =>
      lifecycle.stageUpload({
        stream: Readable.from(await createImage({ format: "png" })),
        originalName: "avatar.png",
        mimeType: "image/png",
      });
    const firstHandle = await stage();
    const first = await lifecycle.processAndPromote(firstHandle);
    const second = await lifecycle.processAndPromote(await stage());

    assert.notEqual(first.reference, second.reference);
    await assertLifecycleError(
      () => lifecycle.processAndPromote(firstHandle),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_HANDLE,
    );
    await assertLifecycleError(
      () => lifecycle.processAndPromote({}),
      CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_HANDLE,
    );
  });
});

test("classifies only exact Client-managed relative references", async () => {
  await withLifecycle(async ({ lifecycle }) => {
    const managed = `/uploads/client-${"a".repeat(48)}.jpg`;

    assert.deepEqual(lifecycle.classifyManagedReference(managed), {
      category: CLIENT_IMAGE_REFERENCE_CATEGORIES.MANAGED,
      reference: managed,
    });
    assert.deepEqual(
      lifecycle.classifyManagedReference(managed, {
        retainedReference: managed,
      }),
      {
        category: CLIENT_IMAGE_REFERENCE_CATEGORIES.RETAINED,
        reference: managed,
      },
    );

    for (const reference of [
      null,
      "",
      "/uploads",
      "/uploads/",
      "/uploads/default.png",
      "/uploads/avatar.jpg",
      "/uploads/client-shared.jpg",
      `/uploads/client-${"A".repeat(48)}.jpg`,
      `/uploads/client-${"a".repeat(48)}.jpeg`,
      `/uploads/client-${"a".repeat(48)}.jpg/child`,
      `/uploads/client-${"a".repeat(48)}.jpg?download=1`,
      `/uploads/client-${"a".repeat(48)}.jpg#fragment`,
      "/uploads/../outside.jpg",
      "/uploads/%2e%2e/outside.jpg",
      "https://example.com/uploads/client-image.jpg",
      "C:\\uploads\\client-image.jpg",
    ]) {
      assert.deepEqual(lifecycle.classifyManagedReference(reference), {
        category: CLIENT_IMAGE_REFERENCE_CATEGORIES.NOT_MANAGED,
      });
    }
  });
});

test("cleans a managed direct file with exactly one deletion attempt", async () => {
  let unlinkCalls = 0;
  await withLifecycle(
    async ({ lifecycle, uploadsRoot }) => {
      const reference = `/uploads/client-${"b".repeat(48)}.png`;
      const target = path.join(uploadsRoot, path.basename(reference));
      await writeFile(target, "managed image");

      const result = await lifecycle.cleanupManagedReference({ reference });

      assert.deepEqual(result, {
        category: CLIENT_IMAGE_CLEANUP_OUTCOMES.CLEANED,
        reference,
      });
      assert.equal(unlinkCalls, 1);
      await assert.rejects(() => lstat(target), { code: "ENOENT" });
    },
    {
      unlinkFn: async (target) => {
        unlinkCalls += 1;
        await rm(target);
      },
    },
  );
});

test("does not attempt cleanup for retained, external, unsafe, or directory references", async () => {
  let unlinkCalls = 0;
  await withLifecycle(
    async ({ lifecycle, uploadsRoot }) => {
      const retained = `/uploads/client-${"c".repeat(48)}.webp`;
      const retainedResult = await lifecycle.cleanupManagedReference({
        reference: retained,
        retainedReference: retained,
      });
      assert.deepEqual(retainedResult, {
        category: CLIENT_IMAGE_CLEANUP_OUTCOMES.RETAINED,
        reference: retained,
      });

      for (const reference of [
        "/uploads/default.png",
        "/uploads/../outside.jpg",
        "https://example.com/image.jpg",
      ]) {
        assert.deepEqual(await lifecycle.cleanupManagedReference({ reference }), {
          category: CLIENT_IMAGE_CLEANUP_OUTCOMES.NOT_CLEANABLE,
        });
      }

      const directoryReference = `/uploads/client-${"d".repeat(48)}.jpg`;
      const directoryPath = path.join(
        uploadsRoot,
        path.basename(directoryReference),
      );
      await mkdir(directoryPath);
      assert.deepEqual(
        await lifecycle.cleanupManagedReference({
          reference: directoryReference,
        }),
        { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.NOT_CLEANABLE },
      );
      assert.equal((await lstat(directoryPath)).isDirectory(), true);
      assert.equal(unlinkCalls, 0);
    },
    {
      unlinkFn: async () => {
        unlinkCalls += 1;
      },
    },
  );
});

test("treats ENOENT during the sole deletion attempt as cleanup success", async () => {
  let unlinkCalls = 0;
  let logCalls = 0;
  await withLifecycle(
    async ({ lifecycle, uploadsRoot }) => {
      const reference = `/uploads/client-${"e".repeat(48)}.jpg`;
      await writeFile(path.join(uploadsRoot, path.basename(reference)), "image");

      const result = await lifecycle.cleanupManagedReference({ reference });

      assert.deepEqual(result, {
        category: CLIENT_IMAGE_CLEANUP_OUTCOMES.MISSING,
        reference,
      });
      assert.equal(unlinkCalls, 1);
      assert.equal(logCalls, 0);
    },
    {
      unlinkFn: async () => {
        unlinkCalls += 1;
        throw Object.assign(new Error("missing absolute target"), {
          code: "ENOENT",
        });
      },
      logger: {
        error: () => {
          logCalls += 1;
        },
      },
    },
  );
});

test("returns a safe failure and logs exact safe cleanup fields without retrying", async () => {
  const events = [];
  let unlinkCalls = 0;
  await withLifecycle(
    async ({ lifecycle, root, uploadsRoot }) => {
      const reference = `/uploads/client-${"f".repeat(48)}.webp`;
      await writeFile(path.join(uploadsRoot, path.basename(reference)), "image");

      const result = await lifecycle.cleanupManagedReference({
        reference,
        operation: "replace-client-image",
        correlationId: "request-42",
      });

      assert.deepEqual(result, {
        category: CLIENT_IMAGE_CLEANUP_OUTCOMES.FAILED,
        reference,
      });
      assert.equal(unlinkCalls, 1);
      assert.deepEqual(events, [
        {
          phase: "cleanup",
          operation: "replace-client-image",
          reference,
          code: "EPERM",
          message: "Filesystem EPERM.",
          correlationId: "request-42",
        },
      ]);
      assert.equal(JSON.stringify(events).includes(root), false);
      assert.equal(JSON.stringify(events).includes("private-token"), false);
      assert.equal(JSON.stringify(events).includes("request-body"), false);
    },
    {
      unlinkFn: async (target) => {
        unlinkCalls += 1;
        throw Object.assign(
          new Error(`${target} private-token request-body`),
          { code: "EPERM" },
        );
      },
      logger: { error: (event) => events.push(event) },
    },
  );
});

test("logger failures do not replace a managed cleanup failure outcome", async () => {
  await withLifecycle(
    async ({ lifecycle, uploadsRoot }) => {
      const reference = `/uploads/client-${"0".repeat(48)}.png`;
      await writeFile(path.join(uploadsRoot, path.basename(reference)), "image");

      assert.deepEqual(await lifecycle.cleanupManagedReference({ reference }), {
        category: CLIENT_IMAGE_CLEANUP_OUTCOMES.FAILED,
        reference,
      });
    },
    {
      unlinkFn: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      logger: {
        error: () => {
          throw new Error("logger unavailable");
        },
      },
    },
  );
});

test("removes partial staging when the upload stream fails", async () => {
  await withLifecycle(async ({ lifecycle, stagingRoot }) => {
    const sourceError = Object.assign(new Error("connection interrupted"), {
      code: "EIO",
    });
    const stream = Readable.from(
      (async function* failingUpload() {
        yield Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        throw sourceError;
      })(),
    );

    await assertLifecycleError(
      () =>
        lifecycle.stageUpload({
          stream,
          originalName: "avatar.png",
          mimeType: "image/png",
        }),
      CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
  });
});

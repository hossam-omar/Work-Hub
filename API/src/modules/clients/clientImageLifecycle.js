import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  lstat,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MANAGED_FILENAME_PATTERN = /^client-[a-f0-9]{48}\.(?:jpg|png|webp)$/;

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(moduleDirectory, "../../..");

const DEFAULT_STAGING_ROOT = path.join(apiRoot, ".client-image-staging");
const DEFAULT_UPLOADS_ROOT = path.join(apiRoot, "uploads");

const FORMATS = Object.freeze({
  jpg: Object.freeze({ format: "jpeg", mimeType: "image/jpeg", output: "jpeg" }),
  jpeg: Object.freeze({
    format: "jpeg",
    mimeType: "image/jpeg",
    output: "jpeg",
  }),
  png: Object.freeze({ format: "png", mimeType: "image/png", output: "png" }),
  webp: Object.freeze({
    format: "webp",
    mimeType: "image/webp",
    output: "webp",
  }),
});

export const CLIENT_IMAGE_ERROR_CATEGORIES = Object.freeze({
  INVALID_HANDLE: "invalid_handle",
  INVALID_IMAGE: "invalid_image",
  TRANSPORT_SIZE_EXCEEDED: "transport_size_exceeded",
  PROCESSED_SIZE_EXCEEDED: "processed_size_exceeded",
  STORAGE_FAILURE: "storage_failure",
});

export const CLIENT_IMAGE_RESULT_CATEGORIES = Object.freeze({
  PROMOTED: "promoted",
});

export const CLIENT_IMAGE_REFERENCE_CATEGORIES = Object.freeze({
  MANAGED: "managed",
  RETAINED: "retained",
  NOT_MANAGED: "not_managed",
});

export const CLIENT_IMAGE_CLEANUP_OUTCOMES = Object.freeze({
  CLEANED: "cleaned",
  MISSING: "missing",
  RETAINED: "retained",
  NOT_CLEANABLE: "not_cleanable",
  FAILED: "failed",
});

const ERROR_MESSAGES = Object.freeze({
  [CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_HANDLE]:
    "The staged Client image handle is invalid.",
  [CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE]:
    "The Client image is invalid.",
  [CLIENT_IMAGE_ERROR_CATEGORIES.TRANSPORT_SIZE_EXCEEDED]:
    "The Client image exceeds the upload size limit.",
  [CLIENT_IMAGE_ERROR_CATEGORIES.PROCESSED_SIZE_EXCEEDED]:
    "The processed Client image exceeds the size limit.",
  [CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE]:
    "The Client image could not be stored.",
});

export class ClientImageLifecycleError extends Error {
  constructor(category) {
    super(ERROR_MESSAGES[category]);
    this.name = "ClientImageLifecycleError";
    this.category = category;
  }
}

const lifecycleError = (category) => new ClientImageLifecycleError(category);

const readUploadDescription = ({ originalName, mimeType }) => {
  if (
    typeof originalName !== "string" ||
    typeof mimeType !== "string" ||
    originalName.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*\.(?:jpe?g|png|webp)$/i.test(originalName)
  ) {
    throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
  }

  const extension = path.extname(originalName).slice(1).toLowerCase();
  const description = FORMATS[extension];

  if (!description || description.mimeType !== mimeType.toLowerCase()) {
    throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
  }

  return { ...description, extension };
};

const detectSignatureFormat = (input) => {
  if (
    input.length >= 3 &&
    input[0] === 0xff &&
    input[1] === 0xd8 &&
    input[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    input.length >= 8 &&
    input.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "png";
  }

  if (
    input.length >= 12 &&
    input.subarray(0, 4).toString("ascii") === "RIFF" &&
    input.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
};

const pngHasAnimationControl = (input) => {
  let offset = 8;
  while (offset + 12 <= input.length) {
    const dataLength = input.readUInt32BE(offset);
    const chunkEnd = offset + dataLength + 12;
    if (chunkEnd > input.length) return false;

    const chunkType = input.subarray(offset + 4, offset + 8).toString("ascii");
    if (chunkType === "acTL") return true;
    if (chunkType === "IEND") return false;
    offset = chunkEnd;
  }
  return false;
};

const outputExtensionFor = (format) => {
  if (format === "jpeg") return "jpg";
  return format;
};

const normalizeErrorCode = (error) =>
  typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code)
    ? error.code
    : "UNKNOWN";

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sanitizeFilesystemMessage = (error, sensitivePaths) => {
  const code = normalizeErrorCode(error);
  if (typeof error?.message !== "string" || error.message.length === 0) {
    return code === "UNKNOWN"
      ? "Filesystem operation failed."
      : `Filesystem ${code}.`;
  }

  let message = error.message.replace(/[\r\n\t]+/g, " ");
  const pathsToRemove = [error.path, ...sensitivePaths]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const sensitivePath of pathsToRemove) {
    message = message.replace(
      new RegExp(escapeRegularExpression(sensitivePath), "gi"),
      "[path]",
    );
  }

  message = message
    .replace(/https?:\/\/[^\s'\"]+/gi, "[url]")
    .replace(/\[path\](?:[\\/][^'\"\r\n]*)?/g, "[path]")
    .replace(/[A-Za-z]:[\\/][^'\"\r\n]*/g, "[path]")
    .replace(/\\\\[^'\"\r\n]*/g, "[path]")
    .replace(/\/[^'\"\r\n]*/g, "[path]")
    .replace(
      /\b(?:authorization|credentials?|password|request[-_ ]?body|secret|token)\b(?:\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+))?/gi,
      "[redacted]",
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  if (message.length === 0) return `Filesystem ${code}.`;
  return message.length <= 256 ? message : `${message.slice(0, 253)}...`;
};

const safeOperation = (operation) =>
  typeof operation === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(operation)
    ? operation
    : "cleanup-client-image";

const safeCorrelationId = (correlationId) =>
  typeof correlationId === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(correlationId)
    ? correlationId
    : undefined;

const isFilesystemError = (error) =>
  typeof error?.code === "string" &&
  [
    "EACCES",
    "EBUSY",
    "EIO",
    "EMFILE",
    "ENFILE",
    "ENOENT",
    "ENOSPC",
    "ENOTDIR",
    "EPERM",
    "EROFS",
    "EXDEV",
  ].includes(error.code);

const createByteLimit = () => {
  let received = 0;

  return new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_IMAGE_BYTES) {
        callback(
          lifecycleError(
            CLIENT_IMAGE_ERROR_CATEGORIES.TRANSPORT_SIZE_EXCEEDED,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
};

const isReadableStream = (value) =>
  value !== null &&
  typeof value === "object" &&
  typeof value.pipe === "function" &&
  typeof value.on === "function";

export const createClientImageLifecycle = ({
  stagingRoot = DEFAULT_STAGING_ROOT,
  uploadsRoot = DEFAULT_UPLOADS_ROOT,
  logger = console,
  createWriteStreamFn = createWriteStream,
  lstatFn = lstat,
  mkdirFn = mkdir,
  readFileFn = readFile,
  renameFn = rename,
  rmFn = rm,
  statFn = stat,
  unlinkFn = unlink,
  randomBytesFn = randomBytes,
  sharpFn = sharp,
} = {}) => {
  const handles = new WeakMap();
  let rootsPromise;

  const logCleanupFailure = ({ operation, reference, correlationId, error }) => {
    const sanitizedCorrelationId = safeCorrelationId(correlationId);
    const event = {
      phase: "cleanup",
      operation: safeOperation(operation),
      reference,
      code: normalizeErrorCode(error),
      message: sanitizeFilesystemMessage(error, [stagingRoot, uploadsRoot]),
    };
    if (sanitizedCorrelationId !== undefined) {
      event.correlationId = sanitizedCorrelationId;
    }
    try {
      logger.error(event);
    } catch {
      // Logging must never replace the primary lifecycle result.
    }
  };

  const ensureRoots = async () => {
    if (!rootsPromise) {
      rootsPromise = (async () => {
        await Promise.all([
          mkdirFn(stagingRoot, { recursive: true }),
          mkdirFn(uploadsRoot, { recursive: true }),
        ]);
        const [stagingInfo, uploadsInfo] = await Promise.all([
          statFn(stagingRoot),
          statFn(uploadsRoot),
        ]);
        if (stagingInfo.dev !== uploadsInfo.dev) {
          const error = new Error("Client image roots must share a filesystem.");
          error.code = "EXDEV";
          throw error;
        }
      })().catch((error) => {
        rootsPromise = undefined;
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE, error);
      });
    }
    return rootsPromise;
  };

  const removeStagingDirectory = async (record, operation) => {
    try {
      await rmFn(record.directory, { recursive: true, force: true });
    } catch (error) {
      logCleanupFailure({
        operation,
        reference: record.promotedReference ?? "staged-client-image",
        correlationId: record.correlationId,
        error,
      });
    }
  };

  const stageUpload = async ({
    stream,
    originalName,
    mimeType,
    correlationId,
  }) => {
    if (!isReadableStream(stream)) {
      throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
    }

    const description = readUploadDescription({ originalName, mimeType });
    await ensureRoots();

    const stagingId = randomBytesFn(24).toString("hex");
    const directory = path.join(stagingRoot, stagingId);
    const rawPath = path.join(directory, `raw.${description.extension}`);
    const record = {
      ...description,
      correlationId,
      directory,
      rawPath,
      state: "staging",
    };
    let ownsStagingDirectory = false;

    try {
      await mkdirFn(directory, { recursive: false });
      ownsStagingDirectory = true;
      await pipeline(stream, createByteLimit(), createWriteStreamFn(rawPath));
    } catch (error) {
      if (ownsStagingDirectory) {
        await removeStagingDirectory(record, "discard-partial-upload");
      }
      if (error instanceof ClientImageLifecycleError) throw error;
      throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE, error);
    }

    record.state = "staged";
    const handle = Object.freeze({});
    handles.set(handle, record);
    return handle;
  };

  const processAndPromote = async (handle) => {
    const record =
      handle !== null && typeof handle === "object" ? handles.get(handle) : null;
    if (!record || record.state !== "staged") {
      throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_HANDLE);
    }

    record.state = "processing";
    const processedPath = path.join(record.directory, `processed.${record.extension}`);

    try {
      let input;
      try {
        input = await readFileFn(record.rawPath);
      } catch (error) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE, error);
      }

      if (detectSignatureFormat(input) !== record.format) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
      }
      if (record.format === "png" && pngHasAnimationControl(input)) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
      }

      let metadata;
      try {
        metadata = await sharpFn(input, {
          animated: true,
          failOn: "warning",
        }).metadata();
      } catch (error) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE, error);
      }

      if (
        metadata.format !== record.format ||
        !Number.isInteger(metadata.width) ||
        !Number.isInteger(metadata.height) ||
        metadata.width < 1 ||
        metadata.height < 1 ||
        metadata.width > MAX_IMAGE_DIMENSION ||
        metadata.height > MAX_IMAGE_DIMENSION ||
        ((record.format === "png" || record.format === "webp") &&
          (metadata.pages ?? 1) !== 1)
      ) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE);
      }

      try {
        const image = sharpFn(input, {
          animated: true,
          failOn: "warning",
        }).autoOrient();
        await image[record.output]().toFile(processedPath);
      } catch (error) {
        const category = isFilesystemError(error)
          ? CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE
          : CLIENT_IMAGE_ERROR_CATEGORIES.INVALID_IMAGE;
        throw lifecycleError(category, error);
      }

      let processedInfo;
      try {
        processedInfo = await statFn(processedPath);
      } catch (error) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE, error);
      }
      if (processedInfo.size > MAX_IMAGE_BYTES) {
        throw lifecycleError(
          CLIENT_IMAGE_ERROR_CATEGORIES.PROCESSED_SIZE_EXCEEDED,
        );
      }

      const outputExtension = outputExtensionFor(record.format);
      const filename = `client-${randomBytesFn(24).toString("hex")}.${outputExtension}`;
      const reference = `/uploads/${filename}`;
      const destination = path.join(uploadsRoot, filename);

      try {
        await renameFn(processedPath, destination);
      } catch (error) {
        throw lifecycleError(CLIENT_IMAGE_ERROR_CATEGORIES.STORAGE_FAILURE, error);
      }

      record.state = "promoted";
      record.promotedReference = reference;
      return {
        category: CLIENT_IMAGE_RESULT_CATEGORIES.PROMOTED,
        reference,
      };
    } finally {
      if (record.state !== "promoted") record.state = "failed";
      await removeStagingDirectory(record, "discard-staging");
    }
  };

  const classifyManagedReference = (reference, { retainedReference } = {}) => {
    if (
      typeof reference !== "string" ||
      !reference.startsWith("/uploads/") ||
      reference.includes("\\") ||
      reference.includes("?") ||
      reference.includes("#") ||
      reference.includes("%")
    ) {
      return { category: CLIENT_IMAGE_REFERENCE_CATEGORIES.NOT_MANAGED };
    }

    const filename = reference.slice("/uploads/".length);
    if (!MANAGED_FILENAME_PATTERN.test(filename)) {
      return { category: CLIENT_IMAGE_REFERENCE_CATEGORIES.NOT_MANAGED };
    }

    if (reference === retainedReference) {
      return {
        category: CLIENT_IMAGE_REFERENCE_CATEGORIES.RETAINED,
        reference,
      };
    }

    return {
      category: CLIENT_IMAGE_REFERENCE_CATEGORIES.MANAGED,
      reference,
    };
  };

  const cleanupManagedReference = async ({
    reference,
    retainedReference,
    operation = "cleanup-client-image",
    correlationId,
  }) => {
    const classification = classifyManagedReference(reference, {
      retainedReference,
    });

    if (classification.category === CLIENT_IMAGE_REFERENCE_CATEGORIES.RETAINED) {
      return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.RETAINED, reference };
    }
    if (
      classification.category === CLIENT_IMAGE_REFERENCE_CATEGORIES.NOT_MANAGED
    ) {
      return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.NOT_CLEANABLE };
    }

    const filename = reference.slice("/uploads/".length);
    const target = path.join(uploadsRoot, filename);
    try {
      const targetInfo = await lstatFn(target);
      if (!targetInfo.isFile()) {
        return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.NOT_CLEANABLE };
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.MISSING, reference };
      }
      logCleanupFailure({ operation, reference, correlationId, error });
      return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.FAILED, reference };
    }

    try {
      await unlinkFn(target);
      return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.CLEANED, reference };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.MISSING, reference };
      }

      logCleanupFailure({ operation, reference, correlationId, error });
      return { category: CLIENT_IMAGE_CLEANUP_OUTCOMES.FAILED, reference };
    }
  };

  return Object.freeze({
    stageUpload,
    processAndPromote,
    classifyManagedReference,
    cleanupManagedReference,
  });
};

export const clientImageLifecycle = createClientImageLifecycle();

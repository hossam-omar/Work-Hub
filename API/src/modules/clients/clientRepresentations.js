const localUploadsPrefix = "/uploads/";

export const publicClientProfileProjection = Object.freeze({
  _id: 1,
  name: 1,
  image_url: 1,
  coverImage_url: 1,
  country: 1,
});

const getUploadFilename = (reference) => {
  if (typeof reference !== "string") return null;

  let candidate = reference.trim();
  if (!candidate || candidate.includes("\\")) return null;

  if (URL.canParse(candidate)) {
    const parsedReference = new URL(candidate);

    if (!["http:", "https:"].includes(parsedReference.protocol)) return null;

    candidate = parsedReference.pathname;
  }

  if (candidate.startsWith(localUploadsPrefix)) {
    candidate = candidate.slice(localUploadsPrefix.length);
  } else if (candidate.startsWith("uploads/")) {
    candidate = candidate.slice("uploads/".length);
  } else if (candidate.startsWith("/")) {
    return null;
  }

  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    candidate.includes("/") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.includes("%") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }

  return candidate;
};

export const normalizePublicClientImage = (reference) => {
  const filename = getUploadFilename(reference);

  return filename ? `${localUploadsPrefix}${filename}` : null;
};

export const toPublicClientProfile = (client) => {
  const source = client?.toObject ? client.toObject() : client;

  return {
    id: String(source._id ?? source.id),
    name: source.name,
    imageUrl: normalizePublicClientImage(source.image_url),
    coverImageUrl: normalizePublicClientImage(source.coverImage_url),
    country: source.country,
  };
};

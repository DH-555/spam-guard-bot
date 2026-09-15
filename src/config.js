import { resolve } from "node:path";

const DISCORD_MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

function readPositiveNumber(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a number greater than 0.`);
  }

  return value;
}

function readRequiredString(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return value;
}

function readNonNegativeInteger(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number greater than or equal to 0.`);
  }

  return value;
}

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a whole number greater than 0.`);
  }

  return value;
}

function readBoolean(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "true") return true;
  if (normalizedValue === "false") return false;

  throw new Error(`${name} must be either true or false.`);
}

export function loadConfig() {
  const timeoutMs = readPositiveNumber("TIMEOUT_MINUTES", 1440) * 60 * 1000;

  if (timeoutMs > DISCORD_MAX_TIMEOUT_MS) {
    throw new Error("TIMEOUT_MINUTES cannot exceed 40320 (28 days).");
  }

  return {
    discordToken: readRequiredString("DISCORD_TOKEN"),
    timeoutMs,
    maxImageBytes: readPositiveNumber("MAX_IMAGE_SIZE_MB", 8) * 1024 * 1024,
    imageDownloadTimeoutMs: readPositiveNumber(
      "IMAGE_DOWNLOAD_TIMEOUT_MS",
      15_000,
    ),
    sendFeedback: readBoolean("SEND_FEEDBACK", true),
    visualReferenceManifestPath: resolve(
      process.env.VISUAL_REFERENCE_MANIFEST_PATH?.trim() ||
        "generated/visual-reference-manifest.json",
    ),
    easterEggPhotoManifestPath: resolve(
      process.env.EASTER_EGG_PHOTO_MANIFEST_PATH?.trim() ||
        "generated/easter-egg-photo-manifest.json",
    ),
    visualMatchThreshold: readNonNegativeInteger("VISUAL_MATCH_THRESHOLD", 6),
    maxImagePixels: readPositiveInteger("MAX_IMAGE_PIXELS", 16_000_000),
  };
}

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
  };
}

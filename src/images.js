import sharp from "sharp";

const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;
const TRUSTED_IMAGE_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);
const TRUSTED_IMAGE_HOST_PATTERN = /^images-ext-\d+\.discordapp\.net$/iu;
const MAX_IMAGE_REDIRECTS = 3;

export function isTrustedImageUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  return (
    parsedUrl.protocol === "https:" &&
    !parsedUrl.username &&
    !parsedUrl.password &&
    (TRUSTED_IMAGE_HOSTS.has(hostname) ||
      TRUSTED_IMAGE_HOST_PATTERN.test(hostname))
  );
}

export function isImageAttachment(attachment) {
  if (attachment.contentType?.toLowerCase().startsWith("image/")) {
    return true;
  }

  return IMAGE_EXTENSIONS.test(attachment.name ?? "");
}

export function getMessageImageSources(message) {
  const sources = [];
  const seenUrls = new Set();

  function addSource(url, label, size = null, forwarded = false) {
    if (!url || seenUrls.has(url) || !isTrustedImageUrl(url)) {
      return;
    }

    seenUrls.add(url);
    sources.push({ url, label, size, forwarded });
  }

  function collectSources(currentMessage, forwarded = false) {
    for (const attachment of currentMessage.attachments?.values?.() ?? []) {
      if (isImageAttachment(attachment)) {
        const label = attachment.name ?? attachment.id;
        addSource(
          attachment.url,
          forwarded ? `Forwarded: ${label}` : label,
          attachment.size,
          forwarded,
        );
      }
    }

    for (const [index, embed] of (currentMessage.embeds ?? []).entries()) {
      if (embed.image) {
        const label =
          embed.url ?? embed.image.url ?? `Embedded image ${index + 1}`;
        addSource(
          embed.image.proxyURL ?? embed.image.url,
          forwarded ? `Forwarded: ${label}` : label,
          null,
          forwarded,
        );
      }

      if (embed.thumbnail) {
        const label =
          embed.url ?? embed.thumbnail.url ?? `Embedded thumbnail ${index + 1}`;
        addSource(
          embed.thumbnail.proxyURL ?? embed.thumbnail.url,
          forwarded ? `Forwarded: ${label}` : label,
          null,
          forwarded,
        );
      }
    }

    for (const snapshot of currentMessage.messageSnapshots?.values?.() ?? []) {
      collectSources(snapshot, true);
    }
  }

  collectSources(message);
  return sources;
}

export async function downloadImage(url, maxBytes, timeoutMs) {
  if (!isTrustedImageUrl(url)) {
    throw new Error("The image URL is not from a trusted Discord image host.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;
    let response;

    for (let redirects = 0; redirects <= MAX_IMAGE_REDIRECTS; redirects += 1) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
      });

      if (response.status < 300 || response.status >= 400) {
        break;
      }

      const location = response.headers.get("location");

      if (!location) {
        throw new Error(`The download returned HTTP ${response.status}.`);
      }

      const nextUrl = new URL(location, currentUrl).toString();

      if (!isTrustedImageUrl(nextUrl)) {
        throw new Error("The image redirect points to an untrusted host.");
      }

      currentUrl = nextUrl;
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error("The image redirect limit was exceeded.");
    }

    if (!response.ok) {
      throw new Error(`The download returned HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("The image exceeds the configured maximum size.");
    }

    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("The download did not contain any data.");
    }

    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("The image exceeds the configured maximum size.");
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertSafeImageDimensions(image, maxPixels) {
  let metadata;

  try {
    metadata = await sharp(image, {
      animated: false,
      limitInputPixels: maxPixels,
    }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit/iu.test(error.message)) {
      throw new Error(
        "The image dimensions exceed the configured safety limit.",
      );
    }

    throw error;
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pixels = width * height;

  if (!width || !height || pixels > maxPixels) {
    throw new Error("The image dimensions exceed the configured safety limit.");
  }
}

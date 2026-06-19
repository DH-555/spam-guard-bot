const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;

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
    if (!url || seenUrls.has(url)) {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });

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

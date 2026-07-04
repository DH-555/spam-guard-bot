import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import sharp from "sharp";

const HASH_ALGORITHM = "sharp-dhash-64-v1";
const DEFAULT_MAX_IMAGE_PIXELS = 16_000_000;
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

function isImageFilePath(path) {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

async function scanDirectory(directoryPath, rootDirectory = directoryPath) {
  const entries = [];
  const children = await readdir(directoryPath, { withFileTypes: true });

  for (const child of children) {
    if (child.name.startsWith(".")) {
      continue;
    }

    const childPath = resolve(directoryPath, child.name);

    if (child.isDirectory()) {
      entries.push(...(await scanDirectory(childPath, rootDirectory)));
      continue;
    }

    if (child.isFile() && isImageFilePath(child.name)) {
      entries.push({
        label: relative(rootDirectory, childPath) || basename(childPath),
        path: childPath,
      });
    }
  }

  return entries;
}

export async function loadVisualReferenceSources(referencePath) {
  const resolvedPath = resolve(referencePath);

  try {
    const stats = await stat(resolvedPath);

    if (stats.isDirectory()) {
      return await scanDirectory(resolvedPath);
    }

    if (stats.isFile() && isImageFilePath(resolvedPath)) {
      return [
        {
          label: basename(resolvedPath),
          path: resolvedPath,
        },
      ];
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return [];
}

async function computeImageHash(input, maxPixels = DEFAULT_MAX_IMAGE_PIXELS) {
  const pixels = await sharp(input, {
    animated: false,
    limitInputPixels: maxPixels,
  })
    .autoOrient()
    .grayscale()
    .resize(9, 8, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer();
  let hash = "";

  for (let row = 0; row < 8; row += 1) {
    const rowOffset = row * 9;

    for (let column = 0; column < 8; column += 1) {
      hash += pixels[rowOffset + column] > pixels[rowOffset + column + 1]
        ? "1"
        : "0";
    }
  }

  return hash;
}

export async function generateVisualReferenceManifest(referencePath) {
  const sources = await loadVisualReferenceSources(referencePath);
  const references = [];

  for (const source of sources) {
    references.push({
      label: source.label,
      hash: await computeImageHash(source.path),
    });
  }

  return {
    algorithm: HASH_ALGORITHM,
    generatedAt: new Date().toISOString(),
    references,
  };
}

export async function writeVisualReferenceManifest(
  referencePath,
  outputPath,
) {
  const manifest = await generateVisualReferenceManifest(referencePath);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

function normalizeManifestEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const label = typeof entry.label === "string" && entry.label.trim()
    ? entry.label
    : null;
  const hash = typeof entry.hash === "string" && entry.hash.trim()
    ? entry.hash
    : null;

  if (!label || !hash) {
    return null;
  }

  return { label, hash };
}

export async function loadVisualReferenceManifest(manifestPath) {
  try {
    const contents = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(contents);

    if (!Array.isArray(parsed) && parsed?.algorithm !== HASH_ALGORITHM) {
      throw new Error(
        `Visual reference manifest uses an unsupported hash algorithm. ` +
          `Regenerate it with "pnpm build:visual-references".`,
      );
    }

    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.references)
        ? parsed.references
        : [];

    return entries.map(normalizeManifestEntry).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function hammingDistance(hashA, hashB) {
  if (hashA.length !== hashB.length) {
    throw new Error("Image hashes must have the same length.");
  }

  let distance = 0;

  for (let index = 0; index < hashA.length; index += 1) {
    if (hashA[index] !== hashB[index]) {
      distance += 1;
    }
  }

  return distance;
}

async function hashCandidateImage(buffer, maxPixels) {
  return computeImageHash(buffer, maxPixels);
}

export async function buildVisualReferenceMatcher(
  references,
  threshold,
  options = {},
) {
  const normalizedReferences = references.map(normalizeManifestEntry).filter(Boolean);
  const maxImagePixels = options.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS;

  return {
    references: normalizedReferences,
    threshold,
    async match(buffer) {
      if (normalizedReferences.length === 0) {
        return null;
      }

      const candidateHash = await hashCandidateImage(buffer, maxImagePixels);
      let bestMatch = null;

      for (const reference of normalizedReferences) {
        const distance = hammingDistance(candidateHash, reference.hash);

        if (distance <= threshold && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = {
            reference,
            distance,
          };
        }
      }

      return bestMatch;
    },
  };
}

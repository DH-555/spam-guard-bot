import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { Jimp } from "jimp";

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

async function computeImageHash(imagePath) {
  const image = await Jimp.read(imagePath);
  return image.pHash();
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

async function hashCandidateImage(buffer) {
  const image = await Jimp.read(buffer);
  return image.pHash();
}

export async function buildVisualReferenceMatcher(references, threshold) {
  const normalizedReferences = references.map(normalizeManifestEntry).filter(Boolean);

  return {
    references: normalizedReferences,
    threshold,
    async match(buffer) {
      if (normalizedReferences.length === 0) {
        return null;
      }

      const candidateHash = await hashCandidateImage(buffer);
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

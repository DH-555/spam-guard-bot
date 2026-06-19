import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  buildVisualReferenceMatcher,
  loadVisualReferenceManifest,
  writeVisualReferenceManifest,
} from "../src/visual-matching.js";

function createHorizontalGradient(width, height, reversed = false) {
  const pixels = Buffer.alloc(width * height * 3);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = reversed
        ? Math.round(255 * (1 - column / (width - 1)))
        : Math.round(255 * (column / (width - 1)));
      const offset = (row * width + column) * 3;
      pixels.fill(value, offset, offset + 3);
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

test("builds a manifest from reference images and matches identical images", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "visual-ref-"));
  const referencePath = join(sourceDirectory, "gradient.png");
  const referenceImage = await createHorizontalGradient(32, 32);
  await sharp(referenceImage).toFile(referencePath);

  const manifestPath = join(sourceDirectory, "manifest.json");
  const manifest = await writeVisualReferenceManifest(
    sourceDirectory,
    manifestPath,
  );

  assert.equal(manifest.references.length, 1);
  assert.equal(manifest.references[0].label, "gradient.png");

  const references = await loadVisualReferenceManifest(manifestPath);
  const matcher = await buildVisualReferenceMatcher(references, 0);
  const match = await matcher.match(referenceImage);

  assert.ok(match);
  assert.equal(match.reference.label, "gradient.png");
  assert.equal(match.distance, 0);
});

test("does not match a visually different image when the threshold is strict", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "visual-ref-"));
  const referencePath = join(sourceDirectory, "gradient.png");
  const referenceImage = await createHorizontalGradient(32, 32);
  await sharp(referenceImage).toFile(referencePath);

  const manifestPath = join(sourceDirectory, "manifest.json");
  await writeVisualReferenceManifest(sourceDirectory, manifestPath);

  const differentImage = await createHorizontalGradient(32, 32, true);

  const references = await loadVisualReferenceManifest(manifestPath);
  const matcher = await buildVisualReferenceMatcher(references, 0);
  const match = await matcher.match(differentImage);

  assert.equal(match, null);
});

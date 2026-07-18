import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  buildEasterEggMatcher,
  loadEasterEggPhotoManifest,
  writeEasterEggPhotoManifest,
} from "../src/easter-egg-matching.js";

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

test("matches a stored easter egg image by hash", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "easter-egg-match-"));
  const referencePath = join(tempDirectory, "meme.png");
  const matchingBuffer = await createHorizontalGradient(32, 32);
  await sharp(matchingBuffer).toFile(referencePath);

  const manifestPath = join(tempDirectory, "manifest.json");
  await writeEasterEggPhotoManifest(tempDirectory, manifestPath);
  const references = await loadEasterEggPhotoManifest(manifestPath);
  const matcher = await buildEasterEggMatcher(references, 0);

  const match = await matcher.match(matchingBuffer);

  assert.equal(match?.reference.label, "meme.png");
  assert.equal(match?.distance, 0);
});

test("ignores a different image", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "easter-egg-no-match-"));
  const referencePath = join(tempDirectory, "meme.png");
  const matchingBuffer = await createHorizontalGradient(32, 32);
  const differentBuffer = await createHorizontalGradient(32, 32, true);
  await sharp(matchingBuffer).toFile(referencePath);

  const manifestPath = join(tempDirectory, "manifest.json");
  await writeEasterEggPhotoManifest(tempDirectory, manifestPath);
  const references = await loadEasterEggPhotoManifest(manifestPath);
  const matcher = await buildEasterEggMatcher(references, 0);

  const match = await matcher.match(differentBuffer);

  assert.equal(match, null);
});

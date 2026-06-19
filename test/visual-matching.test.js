import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp, JimpMime } from "jimp";
import {
  buildVisualReferenceMatcher,
  loadVisualReferenceManifest,
  writeVisualReferenceManifest,
} from "../src/visual-matching.js";

test("builds a manifest from reference images and matches identical images", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "visual-ref-"));
  const referencePath = join(sourceDirectory, "white.png");
  const referenceImage = await new Jimp({
    width: 32,
    height: 32,
    color: 0xffffffff,
  });
  await referenceImage.write(referencePath);

  const manifestPath = join(sourceDirectory, "manifest.json");
  const manifest = await writeVisualReferenceManifest(
    sourceDirectory,
    manifestPath,
  );

  assert.equal(manifest.references.length, 1);
  assert.equal(manifest.references[0].label, "white.png");

  const references = await loadVisualReferenceManifest(manifestPath);
  const matcher = await buildVisualReferenceMatcher(references, 0);
  const candidateBuffer = await referenceImage.getBuffer(JimpMime.png);
  const match = await matcher.match(candidateBuffer);

  assert.ok(match);
  assert.equal(match.reference.label, "white.png");
  assert.equal(match.distance, 0);
});

test("does not match a visually different image when the threshold is strict", async () => {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "visual-ref-"));
  const referencePath = join(sourceDirectory, "white.png");
  const referenceImage = await new Jimp({
    width: 32,
    height: 32,
    color: 0xffffffff,
  });
  await referenceImage.write(referencePath);

  const manifestPath = join(sourceDirectory, "manifest.json");
  await writeVisualReferenceManifest(sourceDirectory, manifestPath);

  const differentImage = await new Jimp({
    width: 32,
    height: 32,
    color: 0x000000ff,
  });

  const references = await loadVisualReferenceManifest(manifestPath);
  const matcher = await buildVisualReferenceMatcher(references, 0);
  const match = await matcher.match(await differentImage.getBuffer(JimpMime.png));

  assert.equal(match, null);
});

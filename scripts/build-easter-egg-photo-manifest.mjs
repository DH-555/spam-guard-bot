import { resolve } from "node:path";
import { writeEasterEggPhotoManifest } from "../src/easter-egg-matching.js";

const referencePath = resolve("easter-egg photos");
const outputPath = resolve("generated/easter-egg-photo-manifest.json");

const manifest = await writeEasterEggPhotoManifest(referencePath, outputPath);

console.log(
  `[Easter eggs] Wrote ${manifest.references.length} hash signature(s) to ${outputPath}.`,
);

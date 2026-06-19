import { resolve } from "node:path";
import { writeVisualReferenceManifest } from "../src/visual-matching.js";

const referencePath = resolve("visual-references");
const outputPath = resolve("generated/visual-reference-manifest.json");

const manifest = await writeVisualReferenceManifest(referencePath, outputPath);

console.log(
  `[Visual matching] Wrote ${manifest.references.length} reference hash(es) to ${outputPath}.`,
);

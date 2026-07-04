import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

export const OCR_EFFORTS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

export const DEFAULT_OCR_EFFORT = OCR_EFFORTS.HIGH;

const OCR_VARIANT_COUNTS = Object.freeze({
  [OCR_EFFORTS.LOW]: 1,
  [OCR_EFFORTS.MEDIUM]: 2,
  [OCR_EFFORTS.HIGH]: 6,
});

const HIGH_EFFORT_CROP_REGIONS = Object.freeze([
  { left: 0, top: 0.28, width: 0.74, height: 0.48 },
  { left: 0.45, top: 0.42, width: 0.55, height: 0.56 },
  { left: 0.55, top: 0.18, width: 0.45, height: 0.58 },
  { left: 0, top: 0.15, width: 0.78, height: 0.7 },
]);

export function normalizeOcrEffort(effort) {
  if (typeof effort !== "string") {
    return DEFAULT_OCR_EFFORT;
  }

  const normalized = effort.trim().toLowerCase();

  if (normalized === OCR_EFFORTS.LOW) {
    return OCR_EFFORTS.LOW;
  }

  if (normalized === OCR_EFFORTS.MEDIUM) {
    return OCR_EFFORTS.MEDIUM;
  }

  if (normalized === OCR_EFFORTS.HIGH) {
    return OCR_EFFORTS.HIGH;
  }

  return DEFAULT_OCR_EFFORT;
}

function scaleCropRegion(region, width, height) {
  const left = Math.max(0, Math.floor(region.left * width));
  const top = Math.max(0, Math.floor(region.top * height));
  const cropWidth = Math.max(1, Math.min(width - left, Math.ceil(region.width * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.ceil(region.height * height)));

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

async function buildOcrVariants(image, effort) {
  const metadata = await sharp(image, { animated: false }).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const variants = [
    {},
    { negate: true },
    ...HIGH_EFFORT_CROP_REGIONS.map((region) => ({
      crop: scaleCropRegion(region, width, height),
    })),
  ];

  return variants.slice(0, OCR_VARIANT_COUNTS[effort]);
}

async function prepareImageForOcr(image, variant) {
  let pipeline = sharp(image, { animated: false })
    .autoOrient()
    .grayscale();

  if (variant.crop) {
    pipeline = pipeline.extract(variant.crop);
  }

  if (variant.negate) {
    pipeline = pipeline.negate();
  }

  return pipeline
    .normalize()
    .sharpen()
    .resize({ width: 1800, withoutEnlargement: false })
    .png()
    .toBuffer();
}

export class OcrService {
  #cachePath;
  #effort;
  #workerPromise;
  #queue = Promise.resolve();

  constructor(cachePath, options = {}) {
    this.#cachePath = cachePath;
    this.#effort = normalizeOcrEffort(options.effort);
  }

  async recognize(image, options = {}) {
    const task = this.#queue.then(async () => {
      const worker = await this.#getWorker();
      const variants = await buildOcrVariants(image, this.#effort);
      const recognizedTexts = [];

      for (const variant of variants) {
        const preparedImage = await prepareImageForOcr(image, variant);
        const result = await worker.recognize(preparedImage);
        const text = result.data.text;

        recognizedTexts.push(text);

        if (options.shouldStop?.(recognizedTexts.join("\n"))) {
          break;
        }
      }

      return recognizedTexts.join("\n");
    });

    this.#queue = task.catch(() => undefined);
    return task;
  }

  async terminate() {
    await this.#queue;

    if (this.#workerPromise) {
      const worker = await this.#workerPromise;
      await worker.terminate();
    }
  }

  #getWorker() {
    this.#workerPromise ??= mkdir(this.#cachePath, { recursive: true }).then(() =>
      createWorker("eng", undefined, {
        cachePath: this.#cachePath,
      }),
    );
    return this.#workerPromise;
  }
}

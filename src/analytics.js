import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ANALYTICS_DETECTION_TYPES = Object.freeze([
  "blockedLink",
  "textScam",
  "maliciousServerInvite",
  "nsfwServerInvite",
  "raid",
  "spamMessage",
  "imageOcr",
  "imageVisual",
  "imageKnownChannel",
  "imageMaliciousServerInvite",
]);

function createEmptyStats() {
  return {
    detections: Object.fromEntries(
      ANALYTICS_DETECTION_TYPES.map((type) => [type, 0]),
    ),
    feedback: {
      correct: 0,
      false: 0,
    },
    manualSpamReports: 0,
  };
}

function normalizeCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeStats(value) {
  const stats = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  return {
    detections: Object.fromEntries(
      ANALYTICS_DETECTION_TYPES.map((type) => [
        type,
        normalizeCounter(stats.detections?.[type]),
      ]),
    ),
    feedback: {
      correct: normalizeCounter(stats.feedback?.correct),
      false: normalizeCounter(stats.feedback?.false),
    },
    manualSpamReports: normalizeCounter(stats.manualSpamReports),
  };
}

export function createEmptyAnalyticsSnapshot() {
  const stats = createEmptyStats();
  return {
    ...stats,
    detections: { ...stats.detections },
    feedback: { ...stats.feedback },
  };
}

export class AnalyticsStore {
  #filePath;
  #enabled;
  #stats = createEmptyStats();
  #writeQueue = Promise.resolve();

  constructor(filePath, enabled = true) {
    this.#filePath = filePath;
    this.#enabled = enabled !== false;
  }

  async load() {
    if (!this.#enabled) return;

    try {
      const contents = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(contents);
      this.#stats = normalizeStats(parsed?.stats ?? parsed);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }

  isEnabled() {
    return this.#enabled;
  }

  getSnapshot() {
    if (!this.#enabled) return null;

    return {
      detections: { ...this.#stats.detections },
      feedback: { ...this.#stats.feedback },
      manualSpamReports: this.#stats.manualSpamReports,
    };
  }

  async flush() {
    await this.#writeQueue;
  }

  async recordDetection(type) {
    if (!this.#enabled || !ANALYTICS_DETECTION_TYPES.includes(type)) return;
    this.#stats.detections[type] += 1;
    await this.#save();
  }

  async recordFeedback(value) {
    if (!this.#enabled) return;
    const key = value === "true" || value === true ? "correct" : "false";
    this.#stats.feedback[key] += 1;
    await this.#save();
  }

  async recordManualSpamReport() {
    if (!this.#enabled) return;
    this.#stats.manualSpamReports += 1;
    await this.#save();
  }

  #save() {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const directory = dirname(this.#filePath);
      const temporaryPath = `${this.#filePath}.tmp`;

      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 1, stats: this.#stats }, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.#filePath);
    });

    return this.#writeQueue;
  }
}

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
  #statsByGuild = new Map();
  #globalStats = createEmptyStats();
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
      // Older versions stored only global counters. Preserve those totals and
      // start per-server counters independently rather than guessing attribution.
      const servers = parsed?.servers;
      if (servers && typeof servers === "object" && !Array.isArray(servers)) {
        this.#statsByGuild = new Map(
          Object.entries(servers)
            .filter(([guildId]) => /^\d{17,20}$/u.test(guildId))
            .map(([guildId, stats]) => [guildId, normalizeStats(stats)]),
        );
        if (parsed?.global) {
          this.#globalStats = normalizeStats(parsed.global);
        } else {
          this.#globalStats = normalizeStats(parsed?.legacyGlobal);
          // Version 2 had per-server totals but no running global aggregate.
          // Fold those new counters into its preserved pre-migration totals.
          for (const stats of this.#statsByGuild.values()) {
            for (const type of ANALYTICS_DETECTION_TYPES) {
              this.#globalStats.detections[type] += stats.detections[type];
            }
            this.#globalStats.feedback.correct += stats.feedback.correct;
            this.#globalStats.feedback.false += stats.feedback.false;
            this.#globalStats.manualSpamReports += stats.manualSpamReports;
          }
        }
      } else if (parsed?.stats || parsed?.detections) {
        this.#globalStats = normalizeStats(parsed?.stats ?? parsed);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }

  isEnabled() {
    return this.#enabled;
  }

  getSnapshot(guildId) {
    if (!this.#enabled) return null;

    const stats = this.#statsByGuild.get(guildId) ?? createEmptyStats();
    return {
      detections: { ...stats.detections },
      feedback: { ...stats.feedback },
      manualSpamReports: stats.manualSpamReports,
    };
  }

  getGlobalSnapshot() {
    if (!this.#enabled) return null;
    return {
      detections: { ...this.#globalStats.detections },
      feedback: { ...this.#globalStats.feedback },
      manualSpamReports: this.#globalStats.manualSpamReports,
    };
  }

  async flush() {
    await this.#writeQueue;
  }

  async recordDetection(guildId, type) {
    if (!this.#enabled || !this.#isGuildId(guildId) || !ANALYTICS_DETECTION_TYPES.includes(type)) return;
    this.#getGuildStats(guildId).detections[type] += 1;
    this.#globalStats.detections[type] += 1;
    await this.#save();
  }

  async recordFeedback(guildId, value) {
    if (!this.#enabled || !this.#isGuildId(guildId)) return;
    const key = value === "true" || value === true ? "correct" : "false";
    this.#getGuildStats(guildId).feedback[key] += 1;
    this.#globalStats.feedback[key] += 1;
    await this.#save();
  }

  async recordManualSpamReport(guildId) {
    if (!this.#enabled || !this.#isGuildId(guildId)) return;
    this.#getGuildStats(guildId).manualSpamReports += 1;
    this.#globalStats.manualSpamReports += 1;
    await this.#save();
  }

  #isGuildId(guildId) {
    return typeof guildId === "string" && /^\d{17,20}$/u.test(guildId);
  }

  #getGuildStats(guildId) {
    if (!this.#statsByGuild.has(guildId)) {
      this.#statsByGuild.set(guildId, createEmptyStats());
    }
    return this.#statsByGuild.get(guildId);
  }

  #save() {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const directory = dirname(this.#filePath);
      const temporaryPath = `${this.#filePath}.tmp`;

      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          version: 3,
          global: this.#globalStats,
          servers: Object.fromEntries(this.#statsByGuild),
        }, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.#filePath);
    });

    return this.#writeQueue;
  }
}

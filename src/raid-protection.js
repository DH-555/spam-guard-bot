export const RAID_LEVELS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const DEFAULT_RAID_LEVEL = RAID_LEVELS.HIGH;
const RAID_WINDOWS_MS = Object.freeze({
  [RAID_LEVELS.HIGH]: 120_000,
  [RAID_LEVELS.MEDIUM]: 60_000,
  [RAID_LEVELS.LOW]: 60_000,
});
const MAX_RAID_WINDOW_MS = Math.max(...Object.values(RAID_WINDOWS_MS));
const MAX_TRACKED_KEYS = 5_000;
const MAX_ENTRIES_PER_KEY = 512;
const RAID_PRUNE_INTERVAL_MS = 30_000;

export function normalizeRaidLevel(level) {
  return Object.values(RAID_LEVELS).includes(level) ? level : DEFAULT_RAID_LEVEL;
}

function threshold(level, requiredChannels = null) {
  switch (normalizeRaidLevel(level)) {
    case RAID_LEVELS.LOW: return requiredChannels ?? 2;
    case RAID_LEVELS.MEDIUM: return 4;
    default: return 3;
  }
}

function windowMs(level) {
  return RAID_WINDOWS_MS[normalizeRaidLevel(level)];
}

export function normalizeRaidMessage(content) {
  return typeof content === "string" ? content.trim().replace(/\s+/gu, " ").toLowerCase() : "";
}

function stablePart(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").toLowerCase() : "";
}

export function getRaidFingerprint(message, imageSources = []) {
  const embeds = [...(message.embeds ?? [])].map((embed) => ({
    title: stablePart(embed.title), description: stablePart(embed.description),
    url: stablePart(embed.url), image: stablePart(embed.image?.url ?? embed.thumbnail?.url),
  }));
  const attachments = [...(message.attachments?.values?.() ?? message.attachments ?? [])]
    .map((attachment) => stablePart(attachment.url ?? attachment.proxyURL ?? attachment.name))
    .filter(Boolean).sort();
  const images = imageSources.map((source) => stablePart(source.url)).filter(Boolean).sort();
  if (!stablePart(message.content) && attachments.length === 0 && images.length === 0 && embeds.length === 0) {
    return "";
  }
  return JSON.stringify({ content: stablePart(message.content), attachments, images, embeds });
}

export class RaidTracker {
  #entries = new Map();
  #lastPrunedAt = 0;

  #prune(now) {
    if (
      now - this.#lastPrunedAt < RAID_PRUNE_INTERVAL_MS &&
      this.#entries.size <= MAX_TRACKED_KEYS
    ) {
      return;
    }

    this.#lastPrunedAt = now;

    for (const [key, entries] of this.#entries) {
      const activeEntries = entries.filter(
        (entry) => now - entry.timestamp <= MAX_RAID_WINDOW_MS,
      );

      if (activeEntries.length === 0) {
        this.#entries.delete(key);
      } else {
        this.#entries.set(key, activeEntries);
      }
    }

    while (this.#entries.size > MAX_TRACKED_KEYS) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }
  }

  record({ guildId, userId, channelId, content, fingerprint, message, level, requiredChannels, now = Date.now() }) {
    this.#prune(now);
    const normalized = normalizeRaidMessage(fingerprint ?? content);
    if (!normalized) return null;
    const key = `${guildId}:${userId}:${normalized}`;
    const entries = (this.#entries.get(key) ?? []).filter((entry) => now - entry.timestamp <= windowMs(level));
    if (
      !entries.some((entry) => entry.channelId === channelId) &&
      entries.length < MAX_ENTRIES_PER_KEY
    ) {
      entries.push({ channelId, message, timestamp: now });
    }
    this.#entries.set(key, entries);
    if (entries.length < threshold(level, requiredChannels)) return null;
    this.#entries.delete(key);
    return entries;
  }
}

export function raidThreshold(level, requiredChannels) { return threshold(level, requiredChannels); }

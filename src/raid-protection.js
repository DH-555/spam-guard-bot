export const RAID_LEVELS = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const DEFAULT_RAID_LEVEL = RAID_LEVELS.HIGH;
const WINDOW_MS = 60_000;

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

export function normalizeRaidMessage(content) {
  return typeof content === "string" ? content.trim().replace(/\\s+/gu, " ").toLowerCase() : "";
}

export class RaidTracker {
  #entries = new Map();

  record({ guildId, userId, channelId, content, message, level, requiredChannels }) {
    const normalized = normalizeRaidMessage(content);
    if (!normalized) return null;
    const now = Date.now();
    const key = `${guildId}:${userId}:${normalized}`;
    const entries = (this.#entries.get(key) ?? []).filter((entry) => now - entry.timestamp < WINDOW_MS);
    if (!entries.some((entry) => entry.channelId === channelId)) {
      entries.push({ channelId, message, timestamp: now });
    }
    this.#entries.set(key, entries);
    if (entries.length < threshold(level, requiredChannels)) return null;
    this.#entries.delete(key);
    return entries;
  }
}

export function raidThreshold(level, requiredChannels) { return threshold(level, requiredChannels); }

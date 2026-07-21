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

  record({ guildId, userId, channelId, content, fingerprint, message, level, requiredChannels }) {
    const normalized = normalizeRaidMessage(fingerprint ?? content);
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

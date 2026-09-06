import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTrustedImageUrl } from "./images.js";

const scamImageChannelsPath = fileURLToPath(
  new URL("../scam-image-channels.json", import.meta.url),
);
const DISCORD_SNOWFLAKE = /^\d{17,20}$/u;

function loadScamImageChannels() {
  try {
    const parsed = JSON.parse(readFileSync(scamImageChannelsPath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : parsed.channels;

    return (entries ?? [])
      .filter((entry) =>
        entry &&
        typeof entry === "object" &&
        DISCORD_SNOWFLAKE.test(entry.channelId),
      )
      .map((entry) => ({
        channelId: entry.channelId,
        name: typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : "Known scam-image channel",
        notes: typeof entry.notes === "string" ? entry.notes.trim() : "",
      }));
  } catch (error) {
    console.warn("[Scam image channels] Could not load scam-image-channels.json:", error);
    return [];
  }
}

export const SCAM_IMAGE_CHANNELS = Object.freeze(loadScamImageChannels());

function getChannelMap(channels) {
  return new Map(
    (channels ?? [])
      .filter((channel) => channel?.channelId)
      .map((channel) => [channel.channelId, channel]),
  );
}

/**
 * Extracts the source channel from a Discord CDN attachment URL.
 * Discord image URLs use /attachments/<channel_id>/<attachment_id>/... .
 */
export function getDiscordAttachmentChannelId(url) {
  if (!isTrustedImageUrl(url)) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(
      /^\/attachments\/(\d{17,20})(?:\/|$)/u,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function findKnownScamImageChannel(
  url,
  channels = SCAM_IMAGE_CHANNELS,
) {
  const channelId = getDiscordAttachmentChannelId(url);

  if (!channelId) {
    return null;
  }

  const channel = getChannelMap(channels).get(channelId);
  return channel ? { ...channel } : null;
}

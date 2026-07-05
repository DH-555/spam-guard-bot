import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { performance } from "node:perf_hooks";
import {
  containsScamPhrase,
  PARANOIA_LEVELS,
  truncateText,
} from "./detection.js";
import {
  assertSafeImageDimensions,
  downloadImage,
  getMessageImageSources,
} from "./images.js";
import { resolveLocale, t } from "./i18n.js";

const REASON =
  "Image detected containing withdrawal and successful-status keywords.";

function resultLabel(result, locale) {
  if (result.status === "fulfilled") {
    return t(locale, "moderation", "yes");
  }

  return t(locale, "moderation", "noPrefix", result.reason instanceof Error ? result.reason.message : String(result.reason));
}

async function findMatchingImage(
  message,
  config,
  ocrService,
  visualMatcher,
  paranoiaLevel,
) {
  const imageSources = getMessageImageSources(message);

  for (const source of imageSources) {
    if (source.size !== null && source.size > config.maxImageBytes) {
      console.warn(
        `[OCR] Image skipped because of its size (${source.size} bytes): ${source.label}`,
      );
      continue;
    }

    try {
      const analysisStartedAt = performance.now();
      const downloadStartedAt = performance.now();
      const image = await downloadImage(
        source.url,
        config.maxImageBytes,
        config.imageDownloadTimeoutMs,
      );
      await assertSafeImageDimensions(image, config.maxImagePixels);
      const downloadMs = performance.now() - downloadStartedAt;
      const visualStartedAt = performance.now();
      const visualMatch = visualMatcher ? await visualMatcher.match(image) : null;
      const visualMs = performance.now() - visualStartedAt;

      if (visualMatch) {
        console.log(
          `[Image analysis] ${source.label}: visual match "${visualMatch.reference.label}" ` +
            `(distance ${visualMatch.distance}; download ${downloadMs.toFixed(0)} ms; ` +
            `hash ${visualMs.toFixed(0)} ms; total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
        );
        return {
          source,
          kind: "visual",
          visualMatch,
        };
      }

      if (paranoiaLevel !== PARANOIA_LEVELS.LOW) {
        const ocrStartedAt = performance.now();
        const text = await ocrService.recognize(image, {
          shouldStop: (recognizedText) =>
            containsScamPhrase(recognizedText, paranoiaLevel),
        });
        const ocrMs = performance.now() - ocrStartedAt;
        console.log(
          `[Image analysis] ${source.label}: no visual match ` +
            `(download ${downloadMs.toFixed(0)} ms; hash ${visualMs.toFixed(0)} ms; ` +
            `OCR ${ocrMs.toFixed(0)} ms; total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
        );

        if (containsScamPhrase(text, paranoiaLevel)) {
          return { source, kind: "ocr", text };
        }
      } else {
        console.log(
          `[Image analysis] ${source.label}: no visual match ` +
            `(download ${downloadMs.toFixed(0)} ms; hash ${visualMs.toFixed(0)} ms; ` +
            `OCR skipped by paranoia level; total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
        );
      }
    } catch (error) {
      console.error(`[Image analysis] Could not analyze ${source.label}:`, error);
    }
  }

  return null;
}

async function sendModerationAlert(
  client,
  message,
  match,
  timeoutMs,
  moderationChannelId,
  deleteResult,
  timeoutResult,
  locale,
) {
  const channel = await client.channels.fetch(moderationChannelId);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error(
      "The configured moderation channel is unavailable or cannot receive messages.",
    );
  }

  const timeoutMinutes = Math.round(timeoutMs / 60_000);
  const detectionMethod =
    match.kind === "visual"
      ? t(
          locale,
          "moderation",
          "visualMatch",
          match.visualMatch.reference.label,
          match.visualMatch.distance,
        )
      : t(locale, "moderation", "ocrMatch");
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(t(locale, "moderation", "alertTitle"))
    .setDescription(t(locale, "moderation", "alertDescription"))
    .addFields(
      {
        name: t(locale, "moderation", "user"),
        value: `${message.author} (\`${message.author.id}\`)`,
      },
      {
        name: t(locale, "moderation", "channel"),
        value: `${message.channel} (\`${message.channelId}\`)`,
      },
      {
        name: t(locale, "moderation", "message"),
        value: `\`${message.id}\``,
        inline: true,
      },
      {
        name: t(locale, "moderation", "imageSource"),
        value: truncateText(match.source.label, 1024),
        inline: true,
      },
      {
        name: t(locale, "moderation", "detectionMethod"),
        value: detectionMethod,
      },
      {
        name: t(locale, "moderation", "timeout", timeoutMinutes),
        value: resultLabel(timeoutResult, locale),
        inline: true,
      },
      {
        name: t(locale, "moderation", "messageDeleted"),
        value: resultLabel(deleteResult, locale),
        inline: true,
      },
      {
        name: t(locale, "moderation", "recognizedText"),
        value:
          match.kind === "visual"
            ? t(locale, "moderation", "ocrSkipped")
            : truncateText(match.text) || t(locale, "moderation", "emptyText"),
      },
    )
    .setThumbnail(message.author.displayAvatarURL())
    .setTimestamp();

  await channel.send({
    content: t(locale, "moderation", "alertContent", message.author.tag),
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

async function sendFallbackNotice(message, locale) {
  const channel = message.channel;

  if (!channel?.isTextBased?.() || !channel.isSendable?.()) {
    throw new Error(
      "The channel where the message was deleted cannot receive fallback notices.",
    );
  }

  await channel.send({
    content: t(locale, "moderation", "fallbackNotice", message.author),
    allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
  });
}

export function createMessageHandler({
  client,
  config,
  ocrService,
  settingsStore,
  visualMatcher,
}) {
  return async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.webhookId) {
      return;
    }

    if (getMessageImageSources(message).length === 0) {
      return;
    }

    const excludedRoleIds = settingsStore.getExcludedRoleIds(message.guildId);
    const excludedAdministrators =
      settingsStore.getExcludedAdministrators(message.guildId);

    let member = message.member;

    if (!member) {
      try {
        member = await message.guild.members.fetch(message.author.id);
      } catch (error) {
        console.warn(
          `[Moderation] Could not resolve guild member ${message.author.id} in guild ${message.guildId}:`,
          error,
        );
        return;
      }
    }

    const hasAdministratorBypass =
      message.guild.ownerId === message.author.id ||
      member.permissions.has(PermissionFlagsBits.Administrator);
    const hasExcludedRole = excludedRoleIds.some((roleId) =>
      member.roles?.cache?.has?.(roleId),
    );

    if ((excludedAdministrators && hasAdministratorBypass) || hasExcludedRole) {
      return;
    }

    const moderationChannelId = settingsStore.getModerationChannelId(
      message.guildId,
    );
    const paranoiaLevel = settingsStore.getParanoiaLevel(message.guildId);
    const timeoutMs = settingsStore.getTimeoutMs(message.guildId) ?? config.timeoutMs;
    const locale = resolveLocale(message.guild);

    const match = await findMatchingImage(
      message,
      config,
      ocrService,
      visualMatcher,
      paranoiaLevel,
    );

    if (!match) {
      return;
    }

    const deletePromise = Promise.resolve().then(() => message.delete());
    const timeoutPromise = Promise.resolve().then(async () => {
      if (!member.moderatable) {
        throw new Error(t(locale, "moderation", "timeoutFailure"));
      }

      return member.timeout(timeoutMs, REASON);
    });

    const [deleteResult, timeoutResult] = await Promise.allSettled([
      deletePromise,
      timeoutPromise,
    ]);

    try {
      if (moderationChannelId) {
        await sendModerationAlert(
          client,
          message,
          match,
          timeoutMs,
          moderationChannelId,
          deleteResult,
          timeoutResult,
          locale,
        );
      } else {
        await sendFallbackNotice(message, locale);
      }
    } catch (error) {
      console.error("[Moderation] Could not send the notification:", error);
    }
  };
}

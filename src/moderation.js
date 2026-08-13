import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { performance } from "node:perf_hooks";
import {
  containsScamPhrase,
  PARANOIA_LEVELS,
  truncateText,
} from "./detection.js";
import { t } from "./i18n.js";
import {
  assertSafeImageDimensions,
  downloadImage,
  getMessageImageSources,
} from "./images.js";
import { resolveLocale } from "./i18n.js";
import { createInviteResolver, findMaliciousInvite } from "./invite-protection.js";
import { findNsfwInvite, NSFW_SERVER_KEYWORDS } from "./nsfw-servers.js";
import { getRaidFingerprint, RaidTracker } from "./raid-protection.js";
import { findSpamMessage, getSpamText } from "./spam-messages.js";

const REASON =
  "Image detected by moderation rules.";

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
  easterEggMatcher,
  paranoiaLevel,
) {
  const imageSources = getMessageImageSources(message);
  const hasEasterEggMatcher =
    easterEggMatcher && easterEggMatcher.references?.length > 0;

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

      if (hasEasterEggMatcher) {
        const easterEggStartedAt = performance.now();
        const easterEggMatch = await easterEggMatcher.match(image);
        const easterEggMs = performance.now() - easterEggStartedAt;

        if (easterEggMatch) {
          console.log(
            `[Image analysis] ${source.label}: easter egg match "${easterEggMatch.reference.label}" ` +
              `(download ${downloadMs.toFixed(0)} ms; hash ${easterEggMs.toFixed(0)} ms; total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
          );
          return {
            source,
            kind: "easterEgg",
            easterEggMatch,
          };
        }
      }

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
        const recognizeOcr =
          ocrService.recognizeWithFallback?.bind(ocrService) ??
          ocrService.recognize.bind(ocrService);
        const text = await recognizeOcr(image, {
          shouldStop: (recognizedText) =>
            containsScamPhrase(recognizedText, paranoiaLevel),
        });
        const ocrMs = performance.now() - ocrStartedAt;
        console.log(
          `[Image analysis] ${source.label}: ` +
            "no visual match " +
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
      : match.kind === "easterEgg"
        ? t(locale, "moderation", "easterEggMatch")
      : t(locale, "moderation", "ocrMatch");
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(t(locale, "moderation", "alertTitle"))
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

async function sendRaidAlert(client, message, entries, timeoutMs, moderationChannelId, locale) {
  if (!moderationChannelId) return sendFallbackNotice(message, locale);
  const channel = await client.channels.fetch(moderationChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("The configured moderation channel is unavailable.");
  const deletedMessages = entries.map((entry) => `${entry.channelId}: ${entry.message.content || "(empty)"}`).join("\n");
  await channel.send({
    content: t(locale, "moderation", "raidAlertContent", message.author.tag),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "raidAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: entries.map((entry) => `<#${entry.channelId}>`).join(", ") },
        { name: t(locale, "moderation", "raidMessage"), value: truncateText(deletedMessages, 4000) },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: "Applied" },
      ).setTimestamp()],
    allowedMentions: { parse: [] },
  });
}

async function sendEasterEggReply(message, locale) {
  await message.reply({
    content: t(locale, "moderation", "easterEggReply"),
    allowedMentions: { repliedUser: false },
  });
}

async function sendSpamAlert(client, message, spamMessage, timeoutResult, deleteResult, timeoutMs, moderationChannelId, locale) {
  if (!moderationChannelId) {
    await sendFallbackNotice(message, locale);
    return;
  }

  const channel = await client.channels.fetch(moderationChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("The configured moderation channel is unavailable or cannot receive messages.");
  }

  await channel.send({
    content: t(locale, "moderation", "spamAlertContent", message.author.tag),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "spamAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "spamMessage"), value: truncateText(`Matched: ${spamMessage}\nContent: ${message.content}`) },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: resultLabel(timeoutResult, locale), inline: true },
        { name: t(locale, "moderation", "messageDeleted"), value: resultLabel(deleteResult, locale), inline: true },
      ).setTimestamp()],
    allowedMentions: { parse: [] },
  });
}

async function sendMaliciousServerAlert(
  client,
  message,
  maliciousInvite,
  timeoutResult,
  deleteResult,
  timeoutMs,
  moderationChannelId,
  locale,
) {
  if (!moderationChannelId) {
    await sendFallbackNotice(message, locale);
    return;
  }

  const channel = await client.channels.fetch(moderationChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("The configured moderation channel is unavailable or cannot receive messages.");
  }

  await channel.send({
    content: t(locale, "moderation", "maliciousServerAlertContent", message.author.tag),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "maliciousServerAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "maliciousServer"), value: `\`${maliciousInvite.guildId}\`` },
        { name: t(locale, "moderation", "inviteCode"), value: `\`${maliciousInvite.code}\``, inline: true },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: resultLabel(timeoutResult, locale), inline: true },
        { name: t(locale, "moderation", "messageDeleted"), value: resultLabel(deleteResult, locale), inline: true },
      )
      .addFields({ name: t(locale, "moderation", "message"), value: truncateText(message.content) })
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
}

async function sendNsfwServerAlert(
  client,
  message,
  nsfwInvite,
  timeoutResult,
  deleteResult,
  timeoutMs,
  moderationChannelId,
  locale,
) {
  if (!moderationChannelId) {
    await sendFallbackNotice(message, locale);
    return;
  }

  const channel = await client.channels.fetch(moderationChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("The configured moderation channel is unavailable or cannot receive messages.");
  }

  await channel.send({
    content: t(locale, "moderation", "nsfwServerAlertContent", message.author.tag),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "nsfwServerAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "serverName"), value: truncateText(nsfwInvite.guildName || t(locale, "moderation", "unknown")) },
        { name: t(locale, "moderation", "matchedKeyword"), value: `\`${nsfwInvite.keyword}\``, inline: true },
        { name: t(locale, "moderation", "serverId"), value: `\`${nsfwInvite.guildId}\``, inline: true },
        { name: t(locale, "moderation", "inviteCode"), value: `\`${nsfwInvite.code}\``, inline: true },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: resultLabel(timeoutResult, locale), inline: true },
        { name: t(locale, "moderation", "messageDeleted"), value: resultLabel(deleteResult, locale), inline: true },
      )
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
}

function shouldIgnoreMember(message, member, settingsStore) {
  const excludedRoleIds = settingsStore.getExcludedRoleIds(message.guildId);
  const excludedAdministrators =
    settingsStore.getExcludedAdministrators(message.guildId);
  const hasAdministratorBypass =
    message.guild.ownerId === message.author.id ||
    member.permissions.has(PermissionFlagsBits.Administrator);
  const hasExcludedRole = excludedRoleIds.some((roleId) =>
    member.roles?.cache?.has?.(roleId),
  );

  return (
    (excludedAdministrators && hasAdministratorBypass) || hasExcludedRole
  );
}

export function createMessageHandler({
  client,
  config,
  ocrService,
  settingsStore,
  visualMatcher,
  easterEggMatcher,
  maliciousGuildIds = [],
  nsfwServerKeywords = NSFW_SERVER_KEYWORDS,
}) {
  const raidTracker = new RaidTracker();
  const resolveInvite = createInviteResolver(client);
  return async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.webhookId) {
      return;
    }

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

    if (shouldIgnoreMember(message, member, settingsStore)) {
      return;
    }

    const moderationChannelId = settingsStore.getModerationChannelId(
      message.guildId,
    );
    const paranoiaLevel = settingsStore.getParanoiaLevel(message.guildId);
    const timeoutMs = settingsStore.getTimeoutMs(message.guildId) ?? config.timeoutMs;
    const raid = settingsStore.getRaidProtection?.(message.guildId) ?? { enabled: true, level: "high" };
    const spam = settingsStore.getSpamProtection?.(message.guildId) ?? { enabled: true };
    const maliciousServer = settingsStore.getMaliciousServerProtection?.(message.guildId) ?? {
      enabled: true,
      blockedGuildIds: [],
    };
    const nsfwServer = settingsStore.getNsfwServerProtection?.(message.guildId) ?? {
      enabled: true,
    };
    const locale = resolveLocale(message.guild);

    if (maliciousServer.enabled) {
      const maliciousInvite = await findMaliciousInvite(
        message.content,
        [...maliciousGuildIds, ...maliciousServer.blockedGuildIds],
        resolveInvite,
      );

      if (maliciousInvite) {
        const deletePromise = Promise.resolve().then(() => message.delete());
        const timeoutPromise = Promise.resolve().then(async () => {
          if (!member.moderatable) {
            throw new Error(t(locale, "moderation", "timeoutFailure"));
          }

          return member.timeout(timeoutMs, "Malicious server invite protection triggered.");
        });
        const [deleteResult, timeoutResult] = await Promise.allSettled([
          deletePromise,
          timeoutPromise,
        ]);

        try {
          await sendMaliciousServerAlert(
            client,
            message,
            maliciousInvite,
            timeoutResult,
            deleteResult,
            timeoutMs,
            moderationChannelId,
            locale,
          );
        } catch (error) {
          console.error("[Malicious server protection] Could not send the notification:", error);
        }
        return;
      }
    }

    if (nsfwServer.enabled) {
      const nsfwInvite = await findNsfwInvite(
        message.content,
        resolveInvite,
        nsfwServerKeywords,
      );

      if (nsfwInvite) {
        const deletePromise = Promise.resolve().then(() => message.delete());
        const timeoutPromise = Promise.resolve().then(async () => {
          if (!member.moderatable) {
            throw new Error(t(locale, "moderation", "timeoutFailure"));
          }

          return member.timeout(timeoutMs, "NSFW server invite protection triggered.");
        });
        const [deleteResult, timeoutResult] = await Promise.allSettled([
          deletePromise,
          timeoutPromise,
        ]);

        try {
          await sendNsfwServerAlert(
            client,
            message,
            nsfwInvite,
            timeoutResult,
            deleteResult,
            timeoutMs,
            moderationChannelId,
            locale,
          );
        } catch (error) {
          console.error("[NSFW server protection] Could not send the notification:", error);
        }
        return;
      }
    }

    if (raid.enabled) {
      const imageSources = getMessageImageSources(message);
      const raidEntries = raidTracker.record({
        guildId: message.guildId, userId: message.author.id, channelId: message.channelId,
        content: message.content, fingerprint: getRaidFingerprint(message, imageSources), message, level: raid.level,
        requiredChannels: raid.level === "low"
          ? message.guild.channels.cache.filter((channel) => channel.isTextBased()).size
          : null,
      });
      if (raidEntries) {
        const deleteResults = await Promise.allSettled(raidEntries.map((entry) => entry.message.delete()));
        const timeoutResult = await Promise.allSettled([member.moderatable ? member.timeout(timeoutMs, "Anti-raid protection triggered.") : Promise.reject(new Error(t(locale, "moderation", "timeoutFailure")))]);
        try { await sendRaidAlert(client, message, raidEntries, timeoutMs, moderationChannelId, locale); }
        catch (error) { console.error("[Anti-raid] Could not send the notification:", error); }
        return;
      }
    }

    const spamText = getSpamText(message);
    const spamMessage = spam.enabled ? findSpamMessage(spamText) : null;
    if (spamMessage) {
      const deletePromise = Promise.resolve().then(() => message.delete());
      const timeoutPromise = Promise.resolve().then(async () => {
        if (!member.moderatable) {
          throw new Error(t(locale, "moderation", "timeoutFailure"));
        }
        return member.timeout(timeoutMs, "Spam message protection triggered.");
      });
      const [deleteResult, timeoutResult] = await Promise.allSettled([deletePromise, timeoutPromise]);
      try {
        await sendSpamAlert(client, message, spamMessage, timeoutResult, deleteResult, timeoutMs, moderationChannelId, locale);
      } catch (error) {
        console.error("[Spam protection] Could not send the notification:", error);
      }
      return;
    }

    if (getMessageImageSources(message).length === 0) return;

    const match = await findMatchingImage(
      message,
      config,
      ocrService,
      visualMatcher,
      easterEggMatcher,
      paranoiaLevel,
    );

    if (!match) {
      return;
    }

    if (match.kind === "easterEgg") {
      try {
        await sendEasterEggReply(message, locale);
      } catch (error) {
        console.error("[Moderation] Could not send the easter egg reply:", error);
      }

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

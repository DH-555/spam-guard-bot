import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { performance } from "node:perf_hooks";
import {
  containsScamPhrase,
  findSuspiciousText,
  findOcrDetectionReasons,
  OCR_DETECTION_REASONS,
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
import { findBlockedLink } from "./blocked-links.js";
import { findNsfwInvite, NSFW_SERVER_KEYWORDS } from "./nsfw-servers.js";
import { getRaidFingerprint, RaidTracker } from "./raid-protection.js";
import { findSpamMessage, getMessageText } from "./spam-messages.js";
import { isKnownSpamUser } from "./spam-users.js";
import { createDetectionFeedback } from "./detection-feedback.js";
import { findKnownScamImageChannel } from "./scam-image-channels.js";
import { OCR_EFFORTS } from "./ocr.js";
import { escapeDiscordMarkdown, sanitizeLogText } from "./security.js";
import { ANALYTICS_DETECTION_TYPES } from "./analytics.js";

const REASON =
  "Image detected by moderation rules.";
const RECENT_THREAD_WINDOW_MS = 10 * 60_000;

function safeEmbedText(value, maxLength = 900) {
  return escapeDiscordMarkdown(truncateText(value, maxLength), maxLength);
}

function resultLabel(result, locale) {
  if (result.status === "fulfilled") {
    return t(locale, "moderation", "yes");
  }

  return t(locale, "moderation", "noPrefix", result.reason instanceof Error ? result.reason.message : String(result.reason));
}

const OCR_REASON_I18N_KEYS = Object.freeze({
  [OCR_DETECTION_REASONS.KEYWORDS]: "ocrKeywords",
  [OCR_DETECTION_REASONS.MR_BEAST]: "ocrMrBeast",
  [OCR_DETECTION_REASONS.MALICIOUS_DOMAIN]: "ocrMaliciousDomain",
  [OCR_DETECTION_REASONS.MALICIOUS_SERVER]: "ocrMaliciousServer",
});

function ocrDetectionMethod(locale, reasons) {
  const labels = [...new Set(reasons ?? [])]
    .map((reason) => OCR_REASON_I18N_KEYS[reason])
    .filter(Boolean)
    .map((key) => t(locale, "moderation", key));

  return t(locale, "moderation", "ocrMatch", labels.length
    ? labels
    : [t(locale, "moderation", "ocrKeywords")]);
}

function recordAnalytics(analytics, method, ...args) {
  if (typeof analytics?.[method] !== "function") return;

  try {
    const result = analytics[method](...args);
    if (result && typeof result.catch === "function") {
      void result.catch((error) => {
        console.warn(`[Analytics] Could not record ${method}:`, error);
      });
    }
  } catch (error) {
    console.warn(`[Analytics] Could not record ${method}:`, error);
  }
}

async function findMatchingImage(
  message,
  config,
  ocrService,
  visualMatcher,
  easterEggMatcher,
  paranoiaLevel,
  resolveInvite,
  maliciousGuildIds,
) {
  const imageSources = getMessageImageSources(message);
  const hasEasterEggMatcher =
    easterEggMatcher && easterEggMatcher.references?.length > 0;
  const shouldCheckMaliciousInvites =
    typeof resolveInvite === "function" && maliciousGuildIds?.length > 0;

  for (const source of imageSources) {
    const knownScamImageChannel = [
      source.url,
      ...(source.alternateUrls ?? []),
    ]
      .map((url) => findKnownScamImageChannel(url))
      .find(Boolean);

    if (knownScamImageChannel) {
      console.log(
        `[Image analysis] ${sanitizeLogText(source.label)}: known scam-image source channel ` +
          `${knownScamImageChannel.channelId} (${knownScamImageChannel.name}).`,
      );
      return {
        source,
        kind: "knownScamImageChannel",
        knownScamImageChannel,
      };
    }

    if (source.size !== null && source.size > config.maxImageBytes) {
      console.warn(
        `[OCR] Image skipped because of its size (${source.size} bytes): ${sanitizeLogText(source.label)}`,
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
            `[Image analysis] ${sanitizeLogText(source.label)}: easter egg match "${sanitizeLogText(easterEggMatch.reference.label)}" ` +
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
          `[Image analysis] ${sanitizeLogText(source.label)}: visual match "${sanitizeLogText(visualMatch.reference.label)}" ` +
            `(distance ${visualMatch.distance}; download ${downloadMs.toFixed(0)} ms; ` +
            `hash ${visualMs.toFixed(0)} ms; total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
        );
        return {
          source,
          kind: "visual",
          visualMatch,
        };
      }

      let ocrText = "";
      let ocrAttempted = false;
      const recognizeOcr = ocrService.recognize?.bind(ocrService) ??
        ocrService.recognizeWithFallback?.bind(ocrService);

      if (recognizeOcr) {
        ocrAttempted = true;
        const recognizePass = (effort) => recognizeOcr(image, {
          effort,
          shouldStop: (recognizedText) =>
            containsScamPhrase(recognizedText, paranoiaLevel),
        });
        const lowStartedAt = performance.now();
        const lowText = await recognizePass(OCR_EFFORTS.LOW);
        ocrText = lowText;
        let maliciousInvite = shouldCheckMaliciousInvites
          ? await findMaliciousInvite(lowText, maliciousGuildIds, resolveInvite)
          : null;

        if (maliciousInvite) {
          console.log(
            `[Image analysis] ${sanitizeLogText(source.label)}: malicious server invite found in OCR ` +
              `(guild ${maliciousInvite.guildId}; OCR low ${(performance.now() - lowStartedAt).toFixed(0)} ms).`,
          );
          return {
            source,
            kind: "maliciousServerInvite",
            maliciousInvite,
            text: lowText,
            ocrReasons: [OCR_DETECTION_REASONS.MALICIOUS_SERVER],
          };
        }

        if (ocrService.singlePass ||
          containsScamPhrase(lowText, paranoiaLevel) ||
          paranoiaLevel === PARANOIA_LEVELS.LOW) {
          const lowMs = performance.now() - lowStartedAt;
          console.log(
            `[Image analysis] ${sanitizeLogText(source.label)}: no visual match ` +
              `(download ${downloadMs.toFixed(0)} ms; hash ${visualMs.toFixed(0)} ms; ` +
              `OCR ${ocrService.singlePass ? "single-pass" : "low"} ${lowMs.toFixed(0)} ms; ` +
              `total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
          );

          if (containsScamPhrase(lowText, paranoiaLevel)) {
            return {
              source,
              kind: "ocr",
              text: lowText,
              ocrReasons: findOcrDetectionReasons(lowText, paranoiaLevel),
            };
          }
        } else {
          const highStartedAt = performance.now();
          const highText = await recognizePass(OCR_EFFORTS.HIGH);
          ocrText = [lowText, highText].filter(Boolean).join("\n");
          maliciousInvite = shouldCheckMaliciousInvites
            ? await findMaliciousInvite(ocrText, maliciousGuildIds, resolveInvite)
            : null;
          const ocrMs = performance.now() - lowStartedAt;

          console.log(
            `[Image analysis] ${sanitizeLogText(source.label)}: no visual match ` +
              `(download ${downloadMs.toFixed(0)} ms; hash ${visualMs.toFixed(0)} ms; ` +
              `OCR low+high ${ocrMs.toFixed(0)} ms; high ${(performance.now() - highStartedAt).toFixed(0)} ms; ` +
              `total ${(performance.now() - analysisStartedAt).toFixed(0)} ms).`,
          );

          if (maliciousInvite) {
            console.log(
              `[Image analysis] ${sanitizeLogText(source.label)}: malicious server invite found in OCR ` +
                `(guild ${maliciousInvite.guildId}; OCR low+high ${ocrMs.toFixed(0)} ms).`,
            );
            return {
              source,
              kind: "maliciousServerInvite",
              maliciousInvite,
              text: ocrText,
              ocrReasons: [OCR_DETECTION_REASONS.MALICIOUS_SERVER],
            };
          }

          if (containsScamPhrase(ocrText, paranoiaLevel)) {
            return {
              source,
              kind: "ocr",
              text: ocrText,
              ocrReasons: findOcrDetectionReasons(ocrText, paranoiaLevel),
            };
          }
        }
      }
    } catch (error) {
      console.error(`[Image analysis] Could not analyze ${sanitizeLogText(source.label)}:`, error);
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
  sendFeedback = true,
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
          safeEmbedText(match.visualMatch.reference.label, 256),
          match.visualMatch.distance,
        )
      : match.kind === "knownScamImageChannel"
        ? t(
            locale,
            "moderation",
            "knownScamImageChannel",
            safeEmbedText(match.knownScamImageChannel.name, 256),
            match.knownScamImageChannel.channelId,
          )
      : match.kind === "easterEgg"
        ? t(locale, "moderation", "easterEggMatch")
      : ocrDetectionMethod(locale, match.ocrReasons);
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
        value: safeEmbedText(match.source.label, 1024),
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
          match.kind === "visual" ||
          (match.kind === "knownScamImageChannel" && !match.ocrAttempted)
            ? t(
                locale,
                "moderation",
                match.kind === "visual" ? "ocrSkipped" : "knownChannelOcrSkipped",
              )
            : safeEmbedText(match.text) || t(locale, "moderation", "emptyText"),
      },
    )
    .setThumbnail(message.author.displayAvatarURL())
    .setTimestamp();

  const feedback = sendFeedback && match.kind === "ocr"
    ? createDetectionFeedback(match, message)
    : null;

  await channel.send({
    content: t(locale, "moderation", "alertContent", safeEmbedText(message.author.tag, 128)),
    embeds: [embed],
    ...(feedback ? { components: feedback.components } : {}),
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
    content: t(locale, "moderation", "raidAlertContent", safeEmbedText(message.author.tag, 128)),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "raidAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: entries.map((entry) => `<#${entry.channelId}>`).join(", ") },
        { name: t(locale, "moderation", "raidMessage"), value: safeEmbedText(deletedMessages, 4000) || "(empty)" },
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

async function sendSpamAlert(client, message, spamMessage, timeoutResult, deleteResult, timeoutMs, moderationChannelId, locale, feedbackMatch = null, sendFeedback = true) {
  if (!moderationChannelId) {
    await sendFallbackNotice(message, locale);
    return;
  }

  const channel = await client.channels.fetch(moderationChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error("The configured moderation channel is unavailable or cannot receive messages.");
  }

  const feedback = sendFeedback && feedbackMatch
    ? createDetectionFeedback(feedbackMatch, message)
    : null;
  await channel.send({
    content: t(locale, "moderation", "spamAlertContent", safeEmbedText(message.author.tag, 128)),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "spamAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "spamMessage"), value: safeEmbedText("Matched: " + spamMessage + "\nContent: " + message.content) || "(empty)" },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: resultLabel(timeoutResult, locale), inline: true },
        { name: t(locale, "moderation", "messageDeleted"), value: resultLabel(deleteResult, locale), inline: true },
      ).setTimestamp()],
    ...(feedback ? { components: feedback.components } : {}),
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
  recognizedText = null,
  detectionMethod = null,
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
    content: t(locale, "moderation", "maliciousServerAlertContent", safeEmbedText(message.author.tag, 128)),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "maliciousServerAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "maliciousServer"), value: `\`${maliciousInvite.guildId}\`` },
        { name: t(locale, "moderation", "inviteCode"), value: `\`${maliciousInvite.code}\``, inline: true },
        { name: t(locale, "moderation", "timeout", Math.round(timeoutMs / 60_000)), value: resultLabel(timeoutResult, locale), inline: true },
        { name: t(locale, "moderation", "messageDeleted"), value: resultLabel(deleteResult, locale), inline: true },
      )
      .addFields(
        { name: t(locale, "moderation", "message"), value: safeEmbedText(message.content) || "(empty)" },
        ...(recognizedText !== null
          ? [{
              name: t(locale, "moderation", "recognizedText"),
              value: safeEmbedText(recognizedText) || t(locale, "moderation", "emptyText"),
            }]
          : []),
        ...(detectionMethod
          ? [{
              name: t(locale, "moderation", "detectionMethod"),
              value: detectionMethod,
            }]
          : []),
      )
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
    content: t(locale, "moderation", "nsfwServerAlertContent", safeEmbedText(message.author.tag, 128)),
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(locale, "moderation", "nsfwServerAlertTitle"))
      .addFields(
        { name: t(locale, "moderation", "user"), value: `${message.author} (\`${message.author.id}\`)` },
        { name: t(locale, "moderation", "channel"), value: `${message.channel} (\`${message.channelId}\`)` },
        { name: t(locale, "moderation", "serverName"), value: safeEmbedText(nsfwInvite.guildName || t(locale, "moderation", "unknown")) || t(locale, "moderation", "unknown") },
        {
          name: t(locale, "moderation", "matchedDetection"),
          value: safeEmbedText(
            nsfwInvite.keyword === "Discord age-restricted server"
              ? nsfwInvite.keyword
              : t(locale, "moderation", "keywordDetection", nsfwInvite.keyword),
            256,
          ),
          inline: true,
        },
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

async function timeoutMember(guild, member, timeoutMs, reason, locale) {
  if (!guild.members) {
    if (!member.moderatable) {
      throw new Error(t(locale, "moderation", "timeoutFailure"));
    }
    return member.timeout(timeoutMs, reason);
  }

  let currentMember = member;

  // `moderatable` depends on the cached bot member. Refresh it when needed
  // so a valid timeout is not rejected because the cache is incomplete.
  if (!guild.members.me && typeof guild.members.fetchMe === "function") {
    try {
      await guild.members.fetchMe();
    } catch (error) {
      console.warn(`[Moderation] Could not refresh the bot member in guild ${guild.id}:`, error);
    }
  }

  // Role changes may not have reached the cached member yet. Refresh the
  // target only when the cached value says it cannot be timed out.
  if (!currentMember.moderatable && typeof guild.members.fetch === "function") {
    try {
      currentMember = await guild.members.fetch({ user: member.id, force: true });
    } catch (error) {
      console.warn(`[Moderation] Could not refresh member ${member.id} in guild ${guild.id}:`, error);
    }
  }

  if (!currentMember.moderatable) {
    const botMember = guild.members.me;
    console.warn("[Moderation] Timeout unavailable", {
      guildId: guild.id,
      userId: currentMember.id,
      targetIsAdministrator:
        currentMember.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false,
      botHasModerateMembers:
        botMember?.permissions?.has?.(PermissionFlagsBits.ModerateMembers) ?? false,
      botRolePosition: botMember?.roles?.highest?.position ?? null,
      targetRolePosition: currentMember.roles?.highest?.position ?? null,
      botRoleId: botMember?.roles?.highest?.id ?? null,
      targetRoleId: currentMember.roles?.highest?.id ?? null,
    });
    throw new Error(t(locale, "moderation", "timeoutFailure"));
  }

  return currentMember.timeout(timeoutMs, reason);
}

function getThreadStartedByMessage(message) {
  if (message.channel?.isThread?.()) return null;

  const thread = message.thread ??
    message.channel?.threads?.cache?.get?.(message.id);

  if (
    !thread?.isThread?.() ||
    thread.ownerId !== message.author.id ||
    typeof thread.delete !== "function"
  ) {
    return null;
  }

  return thread;
}

function getThreadTitle(message) {
  const thread = message.channel?.isThread?.()
    ? message.channel
    : message.thread ?? message.channel?.threads?.cache?.get?.(message.id);

  return typeof thread?.name === "string" ? thread.name : "";
}

function getTimestamp(value) {
  if (Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  return null;
}

function getSnowflakeTimestamp(value) {
  if (typeof value !== "string" || !/^\d{17,20}$/u.test(value)) {
    return null;
  }

  try {
    return Number((BigInt(value) >> 22n) + 1_420_070_400_000n);
  } catch {
    return null;
  }
}

function getEntityTimestamp(entity) {
  return getTimestamp(entity?.createdTimestamp) ??
    getTimestamp(entity?.createdAt) ??
    getSnowflakeTimestamp(entity?.id);
}

function isRecentlyCreatedAuthorThread(message, thread) {
  if (!thread || thread.ownerId !== message.author.id) {
    return false;
  }

  const threadTimestamp = getEntityTimestamp(thread);
  const messageTimestamp = getEntityTimestamp(message);

  if (threadTimestamp === null || messageTimestamp === null) {
    return false;
  }

  const elapsed = messageTimestamp - threadTimestamp;
  return elapsed >= 0 && elapsed <= RECENT_THREAD_WINDOW_MS;
}

async function deleteMessageAndSingleMessageThread(message) {
  const startedThread = getThreadStartedByMessage(message);
  const thread = message.channel?.isThread?.() &&
    message.channel.ownerId === message.author.id &&
    typeof message.channel.messages?.fetch === "function"
    ? message.channel
    : null;
  let shouldDeleteThread = false;

  if (thread) {
    shouldDeleteThread = isRecentlyCreatedAuthorThread(message, thread);

    if (!shouldDeleteThread) {
      try {
        const threadMessages = await thread.messages.fetch({ limit: 2 });
        shouldDeleteThread = threadMessages.size === 1 && threadMessages.has(message.id);
      } catch (error) {
        console.warn(`[Moderation] Could not inspect thread ${thread.id} before deletion:`, error);
      }
    }
  }

  // A message that starts a thread is stored in the parent channel, not in
  // the thread. Delete the thread explicitly before deleting its starter.
  if (startedThread) {
    try {
      await startedThread.delete("Moderated message and its thread.");
    } catch (error) {
      console.warn(`[Moderation] Could not delete thread ${startedThread.id}:`, error);
    }
  }

  await message.delete();

  if (shouldDeleteThread) {
    try {
      await thread.delete("Moderated thread contained only the offending message.");
    } catch (error) {
      console.warn(`[Moderation] Could not delete thread ${thread.id}:`, error);
    }
  }
}

async function timeoutThenDeleteMessage(message, member, timeoutMs, reason, locale) {
  const [timeoutResult] = await Promise.allSettled([
    timeoutMember(message.guild, member, timeoutMs, reason, locale),
  ]);
  const [deleteResult] = await Promise.allSettled([
    deleteMessageAndSingleMessageThread(message),
  ]);
  return { timeoutResult, deleteResult };
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
  analytics = null,
}) {
  const raidTracker = new RaidTracker();
  const resolveInvite = createInviteResolver(client);
  return async function handleMessage(message) {
    if (!message.inGuild() || message.webhookId) {
      return;
    }

    const botDetection = settingsStore.getBotDetection?.(message.guildId) ?? { enabled: false };
    if (message.author.bot && !botDetection.enabled) {
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
    const blockedLinkProtection = settingsStore.getBlockedLinkProtection?.(message.guildId) ?? { enabled: true };
    const locale = resolveLocale(message.guild);
    const threadTitle = getThreadTitle(message);
    const messageText = getMessageText(message);
    const messageAndThreadTitle = [messageText, threadTitle]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n");

    const blockedLink = blockedLinkProtection.enabled ? findBlockedLink(messageText) : null;
    if (blockedLink) {
      recordAnalytics(analytics, "recordDetection", "blockedLink");
      const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
        message, member, timeoutMs, "Blocked link protection triggered.", locale,
      );
      try {
        await sendSpamAlert(
          client,
          message,
          `Blocked link: ${blockedLink}`,
          timeoutResult,
          deleteResult,
          timeoutMs,
          moderationChannelId,
          locale,
        );
      } catch (error) {
        console.error("[Blocked links] Could not send the notification:", error);
      }
      return;
    }

    const suspiciousText = findSuspiciousText(
      [messageText, threadTitle].filter(Boolean).join("\n"),
      settingsStore.getTextScamProtection?.(message.guildId),
      message.author.createdTimestamp,
    );
    if (suspiciousText) {
      recordAnalytics(analytics, "recordDetection", "textScam");
      const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
        message, member, timeoutMs, "Suspicious scam advertisement detected.", locale,
      );
      try {
        await sendSpamAlert(client, message, suspiciousText, timeoutResult, deleteResult, timeoutMs, moderationChannelId, locale, { text: messageText }, config.sendFeedback !== false);
      } catch (error) {
        console.error("[Text scam protection] Could not send the notification:", error);
      }
      return;
    }

    if (maliciousServer.enabled) {
      const maliciousInvite = await findMaliciousInvite(
        messageAndThreadTitle,
        [...maliciousGuildIds, ...maliciousServer.blockedGuildIds],
        resolveInvite,
      );

      if (maliciousInvite) {
        recordAnalytics(analytics, "recordDetection", "maliciousServerInvite");
        const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
          message, member, timeoutMs, "Malicious server invite protection triggered.", locale,
        );

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
        messageAndThreadTitle,
        resolveInvite,
        nsfwServerKeywords,
      );

      if (nsfwInvite) {
        recordAnalytics(analytics, "recordDetection", "nsfwServerInvite");
        const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
          message, member, timeoutMs, "NSFW server invite protection triggered.", locale,
        );

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
        recordAnalytics(analytics, "recordDetection", "raid");
        const timeoutResult = await Promise.allSettled([
          timeoutMember(message.guild, member, timeoutMs, "Anti-raid protection triggered.", locale),
        ]);
        const deleteResults = await Promise.allSettled(
          raidEntries.map((entry) => deleteMessageAndSingleMessageThread(entry.message)),
        );
        try { await sendRaidAlert(client, message, raidEntries, timeoutMs, moderationChannelId, locale); }
        catch (error) { console.error("[Anti-raid] Could not send the notification:", error); }
        return;
      }
    }

    const spamText = messageText;
    const spamMessage = isKnownSpamUser(message.author.id)
      ? "Known spam user"
      : spam.enabled ? findSpamMessage(spamText) : null;
    if (spamMessage) {
      recordAnalytics(analytics, "recordDetection", "spamMessage");
      const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
        message, member, timeoutMs, "Spam message protection triggered.", locale,
      );
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
      resolveInvite,
      maliciousServer.enabled
        ? [...maliciousGuildIds, ...maliciousServer.blockedGuildIds]
        : [],
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

    if (match.kind === "maliciousServerInvite") {
      recordAnalytics(analytics, "recordDetection", "imageMaliciousServerInvite");
      const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
        message,
        member,
        timeoutMs,
        "Malicious server invite found in image OCR.",
        locale,
      );

      try {
        await sendMaliciousServerAlert(
          client,
          message,
          match.maliciousInvite,
          timeoutResult,
          deleteResult,
          timeoutMs,
          moderationChannelId,
          locale,
          match.text,
          ocrDetectionMethod(locale, match.ocrReasons),
        );
      } catch (error) {
        console.error("[Malicious server protection] Could not send the notification:", error);
      }
      return;
    }

    const { timeoutResult, deleteResult } = await timeoutThenDeleteMessage(
      message, member, timeoutMs, REASON, locale,
    );

    const analyticsType = {
      ocr: "imageOcr",
      visual: "imageVisual",
      knownScamImageChannel: "imageKnownChannel",
    }[match.kind];
    if (ANALYTICS_DETECTION_TYPES.includes(analyticsType)) {
      recordAnalytics(analytics, "recordDetection", analyticsType);
    }

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
          config.sendFeedback !== false,
        );
      } else {
        await sendFallbackNotice(message, locale);
      }
    } catch (error) {
      console.error("[Moderation] Could not send the notification:", error);
    }
  };
}

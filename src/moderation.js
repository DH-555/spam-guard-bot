import { EmbedBuilder } from "discord.js";
import { containsScamPhrase, truncateText } from "./detection.js";
import { downloadImage, getMessageImageSources } from "./images.js";

const REASON =
  "Image detected containing withdrawal and successful-status keywords.";

function resultLabel(result) {
  if (result.status === "fulfilled") {
    return "Yes";
  }

  return `No: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
}

async function findMatchingImage(message, config, ocrService) {
  const imageSources = getMessageImageSources(message);

  for (const source of imageSources) {
    if (source.size !== null && source.size > config.maxImageBytes) {
      console.warn(
        `[OCR] Image skipped because of its size (${source.size} bytes): ${source.label}`,
      );
      continue;
    }

    try {
      const image = await downloadImage(
        source.url,
        config.maxImageBytes,
        config.imageDownloadTimeoutMs,
      );
      const text = await ocrService.recognize(image);

      if (containsScamPhrase(text)) {
        return { source, text };
      }
    } catch (error) {
      console.error(`[OCR] Could not analyze ${source.label}:`, error);
    }
  }

  return null;
}

async function sendModerationAlert(
  client,
  message,
  match,
  config,
  moderationChannelId,
  deleteResult,
  timeoutResult,
) {
  const channel = await client.channels.fetch(moderationChannelId);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    throw new Error(
      "The configured moderation channel is unavailable or cannot receive messages.",
    );
  }

  const timeoutMinutes = Math.round(config.timeoutMs / 60_000);
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Suspicious image blocked")
    .setDescription(
      "Withdrawal and successful-status keywords were detected in an image.",
    )
    .addFields(
      {
        name: "User",
        value: `${message.author} (\`${message.author.id}\`)`,
      },
      {
        name: "Channel",
        value: `${message.channel} (\`${message.channelId}\`)`,
      },
      {
        name: "Message",
        value: `\`${message.id}\``,
        inline: true,
      },
      {
        name: "Image source",
        value: truncateText(match.source.label, 1024),
        inline: true,
      },
      {
        name: `Timeout (${timeoutMinutes} min)`,
        value: resultLabel(timeoutResult),
        inline: true,
      },
      {
        name: "Message deleted",
        value: resultLabel(deleteResult),
        inline: true,
      },
      {
        name: "Recognized text",
        value: truncateText(match.text) || "(empty)",
      },
    )
    .setThumbnail(message.author.displayAvatarURL())
    .setTimestamp();

  await channel.send({
    content: `Moderation alert: ${message.author.tag}`,
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

export function createMessageHandler({
  client,
  config,
  ocrService,
  settingsStore,
}) {
  return async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.webhookId) {
      return;
    }

    if (getMessageImageSources(message).length === 0) {
      return;
    }

    const moderationChannelId = settingsStore.getModerationChannelId(
      message.guildId,
    );

    if (!moderationChannelId) {
      return;
    }

    const match = await findMatchingImage(message, config, ocrService);

    if (!match) {
      return;
    }

    const deletePromise = Promise.resolve().then(() => message.delete());
    const timeoutPromise = Promise.resolve().then(async () => {
      const member =
        message.member ??
        (await message.guild.members.fetch(message.author.id));

      if (!member.moderatable) {
        throw new Error(
          "The bot cannot apply a timeout because of permissions or role hierarchy.",
        );
      }

      return member.timeout(config.timeoutMs, REASON);
    });

    const [deleteResult, timeoutResult] = await Promise.allSettled([
      deletePromise,
      timeoutPromise,
    ]);

    try {
      await sendModerationAlert(
        client,
        message,
        match,
        config,
        moderationChannelId,
        deleteResult,
        timeoutResult,
      );
    } catch (error) {
      console.error("[Moderation] Could not send the alert:", error);
    }
  };
}

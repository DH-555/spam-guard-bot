import { PermissionFlagsBits } from "discord.js";
import { FEEDBACK_CHANNEL_ID, FEEDBACK_GUILD_ID } from "./detection-feedback.js";
import { getTrustedImageUrls } from "./images.js";
import { resolveLocale, t } from "./i18n.js";
import { escapeDiscordMarkdown, sanitizeLogText } from "./security.js";

function recordManualReportAnalytics(analytics) {
  if (typeof analytics?.recordManualSpamReport !== "function") return;

  try {
    const result = analytics.recordManualSpamReport();
    if (result && typeof result.catch === "function") {
      void result.catch((error) => {
        console.warn("[Analytics] Could not record manual spam report:", error);
      });
    }
  } catch (error) {
    console.warn("[Analytics] Could not record manual spam report:", error);
  }
}

export async function handleSpamReport(interaction, { sendFeedback = true } = {}, analytics = null) {
  if (!interaction.isMessageContextMenuCommand() || interaction.commandName !== "spamreport") return false;
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: "Necesitas permiso para gestionar mensajes.", ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }
  const targetMessage = interaction.targetMessage;
  const result = await reportSpamMessage(interaction.client, interaction.guild, targetMessage, interaction.user.tag, interaction.user.id, sendFeedback, analytics);
  await interaction.reply({ content: formatReportResult(result), ephemeral: true, allowedMentions: { parse: [] } });
  return true;
}

export async function handleSpamReportMessage(message, { sendFeedback = true } = {}, analytics = null) {
  if (message.author.bot || !message.inGuild() || message.content.trim().toLowerCase() !== "!spamreport") return false;

  try {
    const member = message.member ?? await message.guild.members.fetch(message.author.id);

    if (!member.permissions?.has?.(PermissionFlagsBits.ManageMessages)) {
      await message.reply({
        content: "Necesitas permiso para gestionar mensajes.",
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    if (!message.reference?.messageId) {
      await message.reply({
        content: "Debes responder al mensaje que quieres reportar usando `!spamreport`.",
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    if (typeof message.channel?.messages?.fetch !== "function") {
      throw new Error("The channel cannot fetch the reported message.");
    }

    const targetMessage = await message.channel.messages.fetch(message.reference.messageId);

    if (!targetMessage?.author || targetMessage.author.bot) {
      await message.reply({
        content: "No se pueden reportar mensajes de bots.",
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const result = await reportSpamMessage(
      message.client,
      message.guild,
      targetMessage,
      message.author.tag,
      message.author.id,
      sendFeedback,
      analytics,
    );
    await message.reply({
      content: formatReportResult(result),
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    console.error("[Spam report] Failed:", error);
    try {
      await message.reply({
        content: "No se pudo procesar el reporte. Revisa que el bot pueda ver el canal, borrar mensajes y aplicar timeouts.",
        allowedMentions: { repliedUser: false },
      });
    } catch (replyError) {
      console.error("[Spam report] Could not send the error response:", replyError);
    }
  } finally {
    try {
      await message.delete?.();
    } catch (error) {
      console.warn(`[Spam report] Could not delete command message ${message.id}:`, error);
    }
  }

  return true;
}

function formatReportResult(result) {
  const timeoutStatus = result.timedOut
    ? "Usuario puesto en timeout."
    : "No se pudo aplicar el timeout, pero se intentó borrar el spam.";
  return `${timeoutStatus} Mensajes iguales eliminados: ${result.deleted}.`;
}

async function reportSpamMessage(client, guild, targetMessage, reporterTag, reporterId, sendFeedback = true, analytics = null) {
  const locale = resolveLocale(guild);
  const user = targetMessage.author;
  const content = targetMessage.content;
  let timedOut = false;

  try {
    const member = await guild.members.fetch(user.id);
    await member.timeout(10 * 60_000, `Spam reportado por ${sanitizeLogText(reporterTag, 128)}`);
    timedOut = true;
  } catch (error) {
    console.warn(`[Spam report] Could not timeout member ${user.id}:`, error);
  }

  let deleted = 0;
  const deletedMessageIds = new Set();
  const deleteIfNeeded = async (message) => {
    if (!message?.id || deletedMessageIds.has(message.id)) return;
    deletedMessageIds.add(message.id);

    try {
      await deleteReportedMessage(message);
      deleted += 1;
    } catch (error) {
      console.warn(`[Spam report] Could not delete message ${message.id}:`, error);
    }
  };

  // Always process the reported message itself, including messages in threads
  // that are not present in the guild channel cache.
  await deleteIfNeeded(targetMessage);

  const channels = guild.channels.cache.filter((channel) =>
    channel.isTextBased() &&
    channel.isSendable() &&
    typeof channel.messages?.fetch === "function",
  );
  for (const channel of channels.values()) {
    try {
      let before;
      for (;;) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!messages.size) break;
        const matches = messages.filter((message) => message.author.id === user.id && message.content === content);
        await Promise.all([...matches.values()].map(deleteIfNeeded));
        before = messages.last()?.id;
        if (messages.size < 100) break;
      }
    } catch (error) {
      console.warn(`[Spam report] Could not scan channel ${channel.id}:`, error);
    }
  }

  if (sendFeedback) {
    try {
      const reportChannel = await client.channels.fetch(FEEDBACK_CHANNEL_ID);
      if (reportChannel?.isTextBased() && reportChannel.isSendable() && reportChannel.guildId === FEEDBACK_GUILD_ID) {
        await reportChannel.send({
          content: t(locale, "moderation", "manualSpamReport"),
          embeds: [{ color: 0xed4245, title: t(locale, "moderation", "feedbackTitle"), fields: [
            { name: "Usuario", value: escapeDiscordMarkdown(user.tag, 128) + " (" + user.id + ")" },
            { name: t(locale, "moderation", "originalServerChannel"), value: `${guild.id} / ${targetMessage.channelId}` },
            { name: "Mensaje", value: escapeDiscordMarkdown(content, 1024) || "(empty)" },
            { name: t(locale, "moderation", "reportedBy"), value: escapeDiscordMarkdown(reporterTag, 128) + " (" + reporterId + ")" },
          ] }],
          files: [
            ...getTrustedImageUrls([
              ...[...(targetMessage.attachments?.values?.() ?? [])].map((attachment) => attachment.url),
              ...(targetMessage.embeds ?? []).flatMap((embed) => [embed.image?.url, embed.thumbnail?.url]),
            ]).map((url) => ({ attachment: url })),
          ],
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      console.warn("[Spam report] Could not send the central feedback report:", error);
    }
  }

  if (sendFeedback) {
    recordManualReportAnalytics(analytics);
  }

  return { deleted, timedOut };
}

async function deleteReportedMessage(message) {
  const startedThread = !message.channel?.isThread?.()
    ? message.thread ?? message.channel?.threads?.cache?.get?.(message.id)
    : null;
  const thread = message.channel?.isThread?.() &&
    message.channel.ownerId === message.author.id &&
    typeof message.channel.messages?.fetch === "function"
    ? message.channel
    : null;
  let shouldDeleteThread = false;

  if (thread) {
    try {
      const threadMessages = await thread.messages.fetch({ limit: 2 });
      shouldDeleteThread = threadMessages.size === 1 && threadMessages.has(message.id);
    } catch (error) {
      console.warn(`[Spam report] Could not inspect thread ${thread.id} before deletion:`, error);
    }
  }

  if (startedThread?.isThread?.() &&
      startedThread.ownerId === message.author.id &&
      typeof startedThread.delete === "function") {
    try {
      await startedThread.delete("Reported spam message and its thread.");
    } catch (error) {
      console.warn(`[Spam report] Could not delete thread ${startedThread.id}:`, error);
    }
  }

  await message.delete();

  if (shouldDeleteThread) {
    try {
      await thread.delete("Reported spam thread contained only the offending message.");
    } catch (error) {
      console.warn(`[Spam report] Could not delete thread ${thread.id}:`, error);
    }
  }
}

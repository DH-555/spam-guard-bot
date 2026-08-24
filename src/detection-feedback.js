import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { resolveLocale, t } from "./i18n.js";

export const FEEDBACK_CHANNEL_ID = "1523128007919796224";
export const FEEDBACK_GUILD_ID = "1093301485347020941";
const feedbacks = new Map();

export function createDetectionFeedback(match, message, locale = resolveLocale(message.guild)) {
  const id = randomUUID();
  feedbacks.set(id, {
    messageId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorTag: message.author.tag,
    content: message.content || "(empty)",
    recognizedText: match.text || "(empty)",
    imageUrls: [...new Set([
      match.source?.url,
      ...[...message.attachments.values()].map((attachment) => attachment.url),
      ...message.embeds.flatMap((embed) => [embed.image?.url, embed.thumbnail?.url].filter(Boolean)),
    ].filter(Boolean))],
  });

  return {
    id,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`detection-feedback:false:${id}`).setLabel(t(locale, "moderation", "falseDetection")).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`detection-feedback:true:${id}`).setLabel(t(locale, "moderation", "correctDetection")).setStyle(ButtonStyle.Success),
    )],
  };
}

export async function handleDetectionFeedback(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("detection-feedback:")) return false;
  const [, value, id] = interaction.customId.split(":");
  const feedback = feedbacks.get(id);
  const locale = resolveLocale(interaction);
  if (!feedback) {
    await interaction.reply({ content: t(locale, "moderation", "feedbackExpired"), ephemeral: true });
    return true;
  }

  if (interaction.guildId !== feedback.guildId) {
    await interaction.reply({ content: t(locale, "moderation", "feedbackWrongServer"), ephemeral: true });
    return true;
  }

  const channel = await interaction.client.channels.fetch(FEEDBACK_CHANNEL_ID);
  if (!channel?.isTextBased() || !channel.isSendable() || channel.guildId !== FEEDBACK_GUILD_ID) {
    throw new Error("The detection feedback channel is unavailable or belongs to another server.");
  }

  await channel.send({
    content: t(locale, "moderation", "feedbackReport", value === "true" ? t(locale, "moderation", "feedbackCorrect") : t(locale, "moderation", "feedbackFalse")),
    embeds: [{
      color: value === "true" ? 0x57f287 : 0xed4245,
      title: t(locale, "moderation", "feedbackTitle"),
      fields: [
        { name: t(locale, "moderation", "originalServerChannel"), value: `${feedback.guildId} / ${feedback.channelId}` },
        { name: "Usuario", value: `${feedback.authorTag} (${feedback.messageId})` },
        { name: t(locale, "moderation", "recognizedText"), value: feedback.recognizedText.slice(0, 1024) },
        { name: "Mensaje", value: feedback.content.slice(0, 1024) },
        { name: t(locale, "moderation", "reportedBy"), value: `${interaction.user.tag} (${interaction.user.id})` },
      ],
    }],
    files: feedback.imageUrls.map((url) => ({ attachment: url })),
  });
  feedbacks.delete(id);
  await interaction.update({ components: [] });
  return true;
}

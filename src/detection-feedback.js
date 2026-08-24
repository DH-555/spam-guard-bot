import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export const FEEDBACK_CHANNEL_ID = "1523128007919796224";
export const FEEDBACK_GUILD_ID = "1093301485347020941";
const feedbacks = new Map();

export function createDetectionFeedback(match, message) {
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
      new ButtonBuilder().setCustomId(`detection-feedback:false:${id}`).setLabel("Falsa detección").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`detection-feedback:true:${id}`).setLabel("Detección correcta").setStyle(ButtonStyle.Success),
    )],
  };
}

export async function handleDetectionFeedback(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith("detection-feedback:")) return false;
  const [, value, id] = interaction.customId.split(":");
  const feedback = feedbacks.get(id);
  if (!feedback) {
    await interaction.reply({ content: "Este feedback ya no está disponible.", ephemeral: true });
    return true;
  }

  if (interaction.guildId !== feedback.guildId) {
    await interaction.reply({ content: "Solo puedes valorar esta detección desde su servidor.", ephemeral: true });
    return true;
  }

  const channel = await interaction.client.channels.fetch(FEEDBACK_CHANNEL_ID);
  if (!channel?.isTextBased() || !channel.isSendable() || channel.guildId !== FEEDBACK_GUILD_ID) {
    throw new Error("The detection feedback channel is unavailable or belongs to another server.");
  }

  await channel.send({
    content: `Feedback de detección OCR: **${value === "true" ? "detección correcta" : "falsa detección"}**`,
    embeds: [{
      color: value === "true" ? 0x57f287 : 0xed4245,
      title: "Ayuda a mejorar la detección",
      fields: [
        { name: "Servidor/canal original", value: `${feedback.guildId} / ${feedback.channelId}` },
        { name: "Usuario", value: `${feedback.authorTag} (${feedback.messageId})` },
        { name: "Texto reconocido por OCR", value: feedback.recognizedText.slice(0, 1024) },
        { name: "Mensaje", value: feedback.content.slice(0, 1024) },
        { name: "Feedback enviado por", value: `${interaction.user.tag} (${interaction.user.id})` },
      ],
    }],
    files: feedback.imageUrls.map((url) => ({ attachment: url })),
  });
  feedbacks.delete(id);
  await interaction.update({ components: [] });
  return true;
}

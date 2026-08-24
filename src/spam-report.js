import { PermissionFlagsBits } from "discord.js";
import { FEEDBACK_CHANNEL_ID, FEEDBACK_GUILD_ID } from "./detection-feedback.js";
import { resolveLocale, t } from "./i18n.js";

export async function handleSpamReport(interaction) {
  if (!interaction.isMessageContextMenuCommand() || interaction.commandName !== "spamreport") return false;
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: "Necesitas permiso para gestionar mensajes.", ephemeral: true });
    return true;
  }
  const targetMessage = interaction.targetMessage;
  const user = targetMessage.author;
  const content = targetMessage.content;
  const result = await reportSpamMessage(interaction.client, interaction.guild, targetMessage, interaction.user.tag, interaction.user.id);
  await interaction.reply({ content: `Usuario puesto en timeout. Mensajes iguales eliminados: ${result.deleted}.`, ephemeral: true });
  return true;
}

export async function handleSpamReportMessage(message) {
  if (message.author.bot || message.content.trim().toLowerCase() !== "!spamreport" || !message.reference?.messageId || !message.inGuild()) return false;
  const member = message.member ?? await message.guild.members.fetch(message.author.id);
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  const targetMessage = await message.channel.messages.fetch(message.reference.messageId);
  const result = await reportSpamMessage(message.client, message.guild, targetMessage, message.author.tag, message.author.id);
  await message.reply({ content: `Usuario puesto en timeout. Mensajes iguales eliminados: ${result.deleted}.`, allowedMentions: { repliedUser: false } });
  return true;
}

async function reportSpamMessage(client, guild, targetMessage, reporterTag, reporterId) {
  const locale = resolveLocale(guild);
  const user = targetMessage.author;
  const content = targetMessage.content;
  const member = await guild.members.fetch(user.id);
  await member.timeout(10 * 60_000, `Spam reportado por ${reporterTag}`);
  let deleted = 0;
  const channels = guild.channels.cache.filter((channel) => channel.isTextBased() && channel.isSendable());
  for (const channel of channels.values()) {
    let before;
    for (;;) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!messages.size) break;
      const matches = messages.filter((message) => message.author.id === user.id && message.content === content);
      const results = await Promise.allSettled([...matches.values()].map((message) => message.delete()));
      deleted += results.filter((result) => result.status === "fulfilled").length;
      before = messages.last()?.id;
      if (messages.size < 100) break;
    }
  }
  const reportChannel = await client.channels.fetch(FEEDBACK_CHANNEL_ID);
  if (reportChannel?.isTextBased() && reportChannel.isSendable() && reportChannel.guildId === FEEDBACK_GUILD_ID) {
    await reportChannel.send({
      content: t(locale, "moderation", "manualSpamReport"),
      embeds: [{ color: 0xed4245, title: t(locale, "moderation", "feedbackTitle"), fields: [
        { name: "Usuario", value: `${user.tag} (${user.id})` },
        { name: t(locale, "moderation", "originalServerChannel"), value: `${guild.id} / ${targetMessage.channelId}` },
        { name: "Mensaje", value: content.slice(0, 1024) || "(empty)" },
        { name: t(locale, "moderation", "reportedBy"), value: `${reporterTag} (${reporterId})` },
      ] }],
      files: [
        ...[...targetMessage.attachments.values()].map((attachment) => ({ attachment: attachment.url })),
        ...targetMessage.embeds.flatMap((embed) => [embed.image?.url, embed.thumbnail?.url].filter(Boolean)).map((url) => ({ attachment: url })),
      ],
    });
  }
  return { deleted };
}

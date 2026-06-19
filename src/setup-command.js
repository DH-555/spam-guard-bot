import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { resolveLocale, t } from "./i18n.js";

const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure D5 spam guard bot for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("moderation-channel")
      .setDescription("Choose where moderation alerts are sent.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel that will receive moderation alerts.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Show the current configuration for this server."),
  );

export async function registerSetupCommands(client) {
  await Promise.all(
    client.guilds.cache.map((guild) => registerSetupCommandForGuild(guild)),
  );
}

export async function registerSetupCommandForGuild(guild) {
  await guild.commands.set([setupCommand.toJSON()]);
}

export function createSetupCommandHandler({ settingsStore }) {
  return async function handleSetupCommand(interaction) {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== "setup"
    ) {
      return;
    }

    if (!interaction.inGuild()) {
      await interaction.reply({
        content: t(resolveLocale(interaction), "setup", "onlyInServer"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: t(resolveLocale(interaction), "setup", "manageServerRequired"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const locale = resolveLocale(interaction);

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "moderation-channel") {
      const channel = interaction.options.getChannel("channel", true);
      const botMember =
        interaction.guild.members.me ??
        (await interaction.guild.members.fetchMe());
      const botPermissions = channel.permissionsFor(botMember);

      if (
        !channel.isTextBased() ||
        !channel.isSendable() ||
        !botPermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        await interaction.reply({
          content: t(locale, "setup", "missingBotPermissions"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await settingsStore.setModerationChannelId(
        interaction.guildId,
        channel.id,
      );
      await interaction.reply({
        content: t(locale, "setup", "saved", channel),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = settingsStore.getModerationChannelId(interaction.guildId);
    await interaction.reply({
      content: channelId
        ? t(locale, "setup", "currentSet", channelId)
        : t(locale, "setup", "notConfigured"),
      flags: MessageFlags.Ephemeral,
    });
  };
}

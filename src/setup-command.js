import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure Anti Mr Scam bot for this server.")
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
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "You need the Manage Server permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
          content:
            "The bot needs View Channel, Send Messages, and Embed Links permissions in the selected channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await settingsStore.setModerationChannelId(
        interaction.guildId,
        channel.id,
      );
      await interaction.reply({
        content: `Moderation alerts will now be sent to ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = settingsStore.getModerationChannelId(interaction.guildId);
    await interaction.reply({
      content: channelId
        ? `The moderation channel is currently set to <#${channelId}>.`
        : "No moderation channel has been configured. Use `/setup moderation-channel`.",
      flags: MessageFlags.Ephemeral,
    });
  };
}

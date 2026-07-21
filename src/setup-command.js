import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { PARANOIA_LEVELS, normalizeParanoiaLevel } from "./detection.js";
import { resolveLocale, t } from "./i18n.js";
import { RAID_LEVELS } from "./raid-protection.js";

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
  .addSubcommand((subcommand) => subcommand.setName("anti-raid").setDescription("Enable or configure anti-raid protection.")
    .addBooleanOption((option) => option.setName("enabled").setDescription("Whether anti-raid is enabled.").setRequired(true))
    .addStringOption((option) => option.setName("level").setDescription("Sensitivity level.").setRequired(true)
      .addChoices({ name: "high", value: RAID_LEVELS.HIGH }, { name: "medium", value: RAID_LEVELS.MEDIUM }, { name: "low", value: RAID_LEVELS.LOW })))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("paranoia")
      .setDescription("Set the detection sensitivity for this server.")
      .addStringOption((option) =>
        option
          .setName("level")
          .setDescription("The paranoia level to use.")
          .setRequired(true)
          .addChoices(
            { name: "low", value: PARANOIA_LEVELS.LOW },
            { name: "medium", value: PARANOIA_LEVELS.MEDIUM },
            { name: "high", value: PARANOIA_LEVELS.HIGH },
            { name: "extreme", value: PARANOIA_LEVELS.EXTREME },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("timeout")
      .setDescription("Set the timeout duration for this server.")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("The timeout duration in minutes.")
          .setMinValue(1)
          .setMaxValue(40320)
          .setRequired(true),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("excluded-role")
      .setDescription("Manage roles that are ignored by detection.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("add")
          .setDescription("Exclude a role from detection.")
          .addRoleOption((option) =>
            option
              .setName("role")
              .setDescription("The role to exclude from detection.")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Allow a previously excluded role again.")
          .addRoleOption((option) =>
            option
              .setName("role")
              .setDescription("The role to remove from the exclusion list.")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("list").setDescription("Show excluded roles."),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("excluded-administrators")
      .setDescription("Manage whether server administrators are ignored.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("enable")
          .setDescription("Exclude server administrators from detection."),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("disable")
          .setDescription("Allow server administrators to be moderated."),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Show the current configuration for this server."),
  );

function formatParanoiaLevel(locale, level) {
  switch (normalizeParanoiaLevel(level)) {
    case PARANOIA_LEVELS.LOW:
      return t(locale, "setup", "paranoiaLow");
    case PARANOIA_LEVELS.MEDIUM:
      return t(locale, "setup", "paranoiaMedium");
    case PARANOIA_LEVELS.EXTREME:
      return t(locale, "setup", "paranoiaExtreme");
    default:
      return t(locale, "setup", "paranoiaHigh");
  }
}

function formatTimeoutMinutes(timeoutMs) {
  return Math.max(1, Math.round(timeoutMs / 60_000));
}

function formatExcludedRoles(interaction, roleIds, excludedAdministrators) {
  const roles = [...roleIds];

  if (excludedAdministrators) {
    roles.unshift(t(resolveLocale(interaction), "setup", "excludedAdministratorsLabel"));
  }

  if (roles.length === 0) {
    return t(resolveLocale(interaction), "setup", "noExcludedRoles");
  }

  return roles
    .map((roleId) =>
      roleId === t(resolveLocale(interaction), "setup", "excludedAdministratorsLabel")
        ? roleId
        : interaction.guild.roles.cache.get(roleId)?.toString() ?? `<@&${roleId}>`,
    )
    .join(", ");
}

export async function registerSetupCommands(client) {
  await Promise.all(
    client.guilds.cache.map((guild) => registerSetupCommandForGuild(guild)),
  );
}

export async function registerSetupCommandForGuild(guild) {
  await guild.commands.set([setupCommand.toJSON()]);
}

export function createSetupCommandHandler({ settingsStore, config }) {
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

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
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

    if (subcommand === "paranoia") {
      const level = interaction.options.getString("level", true);
      await settingsStore.setParanoiaLevel(interaction.guildId, level);
      await interaction.reply({
        content: t(locale, "setup", "paranoiaSaved", formatParanoiaLevel(locale, level)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "timeout") {
      const minutes = interaction.options.getInteger("minutes", true);
      await settingsStore.setTimeoutMs(interaction.guildId, minutes * 60_000);
      await interaction.reply({
        content: t(locale, "setup", "timeoutSaved", minutes),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "anti-raid") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const level = interaction.options.getString("level", true);
      await settingsStore.setRaidProtection(interaction.guildId, enabled, level);
      await interaction.reply({ content: t(locale, "setup", "antiRaidSaved", enabled, level), flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommandGroup === "excluded-role") {
      const role = interaction.options.getRole("role", subcommand !== "list");

      if (subcommand === "add" && role) {
        await settingsStore.addExcludedRoleId(interaction.guildId, role.id);
        await interaction.reply({
          content: t(locale, "setup", "excludedRoleAdded", role),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (subcommand === "remove" && role) {
        await settingsStore.removeExcludedRoleId(interaction.guildId, role.id);
        await interaction.reply({
          content: t(locale, "setup", "excludedRoleRemoved", role),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const excludedRoleIds = settingsStore.getExcludedRoleIds(interaction.guildId);
      const excludedAdministrators =
        settingsStore.getExcludedAdministrators(interaction.guildId);
      await interaction.reply({
        content: t(
          locale,
          "setup",
          "excludedRolesList",
          formatExcludedRoles(
            interaction,
            excludedRoleIds,
            excludedAdministrators,
          ),
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommandGroup === "excluded-administrators") {
      if (subcommand === "enable") {
        await settingsStore.setExcludedAdministrators(interaction.guildId, true);
        await interaction.reply({
          content: t(locale, "setup", "excludedAdministratorsEnabled"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (subcommand === "disable") {
        await settingsStore.setExcludedAdministrators(interaction.guildId, false);
        await interaction.reply({
          content: t(locale, "setup", "excludedAdministratorsDisabled"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const channelId = settingsStore.getModerationChannelId(interaction.guildId);
    const paranoiaLevel = settingsStore.getParanoiaLevel(interaction.guildId);
    const timeoutMs = settingsStore.getTimeoutMs(interaction.guildId) ?? config.timeoutMs;
    const excludedRoleIds = settingsStore.getExcludedRoleIds(interaction.guildId);
    const excludedAdministrators =
      settingsStore.getExcludedAdministrators(interaction.guildId);
    const raid = settingsStore.getRaidProtection(interaction.guildId);
    await interaction.reply({
      content: [
        channelId
          ? t(locale, "setup", "currentSet", channelId)
          : t(locale, "setup", "notConfigured"),
        t(locale, "setup", "currentParanoia", formatParanoiaLevel(locale, paranoiaLevel)),
        t(locale, "setup", "currentTimeout", formatTimeoutMinutes(timeoutMs)),
        t(
          locale,
          "setup",
          "currentExcludedRoles",
          formatExcludedRoles(interaction, excludedRoleIds, excludedAdministrators),
        ),
        t(locale, "setup", "currentAntiRaid", raid.enabled, raid.level),
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  };
}

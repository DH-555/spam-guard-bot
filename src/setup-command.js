import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { DM_POLICIES, PARANOIA_LEVELS, normalizeParanoiaLevel } from "./detection.js";
import { resolveLocale, t } from "./i18n.js";
import { isDiscordGuildId } from "./invite-protection.js";
import { RAID_LEVELS } from "./raid-protection.js";
import { createEmptyAnalyticsSnapshot } from "./analytics.js";

const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Open the server settings panel.")
  .setDescriptionLocalizations({
    "es-ES": "Abre el panel de configuración del servidor.",
    "es-419": "Abre el panel de configuración del servidor.",
  })
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((subcommand) => subcommand
    .setName("panel")
    .setDescription("Configure this server with buttons and menus.")
    .setDescriptionLocalizations({
      "es-ES": "Configura este servidor con botones y menús.",
      "es-419": "Configura este servidor con botones y menús.",
    }));

const spamCommand = new SlashCommandBuilder()
  .setName("spam")
  .setDescription("View global or this server's spam analytics.")
  .setDescriptionLocalizations({
    "es-ES": "Consulta estadísticas globales o de este servidor.",
    "es-419": "Consulta estadísticas globales o de este servidor.",
  })
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageGuild,
  )
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("analytics")
      .setDescription("View spam statistics from this server.")
      .setDescriptionLocalizations({
        "es-ES": "Consulta estadísticas de spam de este servidor.",
        "es-419": "Consulta estadísticas de spam de este servidor.",
      }),
  )
  .addSubcommand((subcommand) => subcommand
    .setName("global")
    .setDescription("View combined spam statistics from all servers.")
    .setDescriptionLocalizations({
      "es-ES": "Consulta las estadísticas de spam de todos los servidores.",
      "es-419": "Consulta las estadísticas de spam de todos los servidores.",
    }));

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
  await guild.commands.set([setupCommand.toJSON(), spamCommand.toJSON()]);
}

function formatAnalytics(locale, snapshot, global = false) {
  const { detections, feedback } = snapshot;
  const totalDetections = Object.values(detections).reduce(
    (total, count) => total + count,
    0,
  );

  return [
    t(locale, "setup", global ? "analyticsGlobalTitle" : "analyticsTitle"),
    t(locale, "setup", global ? "analyticsGlobalScope" : "analyticsScope"),
    "",
    `${t(locale, "setup", "analyticsTotalDetections")}: ${totalDetections}`,
    `${t(locale, "setup", "analyticsImageOcr")}: ${detections.imageOcr}`,
    `${t(locale, "setup", "analyticsImageVisual")}: ${detections.imageVisual}`,
    `${t(locale, "setup", "analyticsTextScam")}: ${detections.textScam}`,
    `${t(locale, "setup", "analyticsSpamMessage")}: ${detections.spamMessage}`,
    `${t(locale, "setup", "analyticsBlockedLink")}: ${detections.blockedLink}`,
    `${t(locale, "setup", "analyticsMaliciousInvite")}: ${detections.maliciousServerInvite + detections.imageMaliciousServerInvite}`,
    `${t(locale, "setup", "analyticsNsfwInvite")}: ${detections.nsfwServerInvite}`,
    `${t(locale, "setup", "analyticsRaid")}: ${detections.raid}`,
    `${t(locale, "setup", "analyticsKnownChannel")}: ${detections.imageKnownChannel}`,
    "",
    `${t(locale, "setup", "analyticsManualReports")}: ${snapshot.manualSpamReports}`,
    `${t(locale, "setup", "analyticsCorrectFeedback")}: ${feedback.correct}`,
    `${t(locale, "setup", "analyticsFalseFeedback")}: ${feedback.false}`,
  ].join("\n");
}

export function createSetupCommandHandler({ settingsStore, config, analytics }) {
  function enabledButton(guildId, locale, key, label, enabled) {
    return new ButtonBuilder()
      .setCustomId(`setup-toggle:${key}:${guildId}`)
      .setLabel(`${label}: ${t(locale, "setup", enabled ? "enabledLabel" : "disabledLabel")}`)
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
  }

  function createSettingsPanel(guildId, locale, page = "main", ephemeral = true, notice = null, interaction = null) {
    const raid = settingsStore.getRaidProtection(guildId);
    const spam = settingsStore.getSpamProtection(guildId);
    const links = settingsStore.getBlockedLinkProtection(guildId);
    const malicious = settingsStore.getMaliciousServerProtection(guildId);
    const nsfw = settingsStore.getNsfwServerProtection(guildId);
    const botDetection = settingsStore.getBotDetection(guildId);
    const antiNovaVoidBox = settingsStore.getAntiNovaVoidBox?.(guildId) ?? { enabled: false };
    const textScams = settingsStore.getTextScamProtection(guildId);
    const paranoia = settingsStore.getParanoiaLevel(guildId);
    const rows = [];
    let content;

    if (page === "main") {
      const toggles = [
        ["raid", "panelAntiRaid", raid.enabled],
        ["spam", "panelSpam", spam.enabled],
        ["links", "panelBlockedLinks", links.enabled],
        ["malicious", "panelMaliciousInvites", malicious.enabled],
        ["nsfw", "panelNsfwInvites", nsfw.enabled],
        ["bots", "panelBotDetection", botDetection.enabled],
        ["antiNovaVoidBox", "panelAntiNovaVoidBox", antiNovaVoidBox.enabled],
        ["textRemoteJobs", "panelRemoteJobs", textScams.remoteJobs],
        ["textGiveaways", "panelGiveaways", textScams.giveaways],
        ["excludedAdministrators", "panelExcludedAdministrators", settingsStore.getExcludedAdministrators(guildId)],
      ];
      for (let index = 0; index < toggles.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(toggles.slice(index, index + 5).map(([key, labelKey, enabled]) =>
          enabledButton(guildId, locale, key, t(locale, "setup", labelKey), enabled),
        )));
      }
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`setup-select:paranoia:${guildId}`)
          .setPlaceholder(`${t(locale, "setup", "panelParanoiaSensitivity")}: ${formatParanoiaLevel(locale, paranoia)}`)
          .addOptions(Object.values(PARANOIA_LEVELS).map((level) => ({
            label: `${t(locale, "setup", "panelParanoiaSensitivity")}: ${formatParanoiaLevel(locale, level)}`,
            value: level,
            default: level === paranoia,
          }))),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`setup-select:raid:${guildId}`)
          .setPlaceholder(`${t(locale, "setup", "panelRaidSensitivity")}: ${t(locale, "setup", `raidSensitivity${raid.level[0].toUpperCase()}${raid.level.slice(1)}`)}`)
          .addOptions(Object.values(RAID_LEVELS).map((level) => ({
            label: `${t(locale, "setup", "panelRaidSensitivity")}: ${t(locale, "setup", `raidSensitivity${level[0].toUpperCase()}${level.slice(1)}`)}`,
            value: level,
            default: level === raid.level,
          }))),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup-page:advanced:${guildId}`).setLabel(t(locale, "setup", "panelAdvanced")).setStyle(ButtonStyle.Primary),
      ));
      content = t(locale, "setup", "panelDescription");
    } else {
      const channelId = settingsStore.getModerationChannelId(guildId);
      const timeoutMs = settingsStore.getTimeoutMs(guildId) ?? config.timeoutMs;
      const excludedRoleIds = settingsStore.getExcludedRoleIds(guildId);
      const excludedAdministrators = settingsStore.getExcludedAdministrators(guildId);
      const blockedIds = malicious.blockedGuildIds;
      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`setup-channel:moderation:${guildId}`)
        .setPlaceholder(t(locale, "setup", "panelModerationChannel"))
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
      if (channelId) channelSelect.setDefaultChannels(channelId);
      rows.push(new ActionRowBuilder().addComponents(channelSelect));
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`setup-select:dmPolicy:${guildId}`)
          .setPlaceholder(`${t(locale, "setup", "panelDmPolicy")}: ${t(locale, "setup", `dmPolicy${textScams.dmPolicy[0].toUpperCase()}${textScams.dmPolicy.slice(1)}`)}`)
          .addOptions([
            { label: t(locale, "setup", "dmPolicyAllow"), value: DM_POLICIES.ALLOW, default: textScams.dmPolicy === DM_POLICIES.ALLOW },
            { label: t(locale, "setup", "dmPolicyDeny"), value: DM_POLICIES.DENY, default: textScams.dmPolicy === DM_POLICIES.DENY },
            { label: t(locale, "setup", "dmPolicyRecent"), value: DM_POLICIES.RECENT, default: textScams.dmPolicy === DM_POLICIES.RECENT },
          ]),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`setup-role:add:${guildId}`)
          .setPlaceholder(t(locale, "setup", "panelAddExcludedRoles"))
          .setMinValues(1).setMaxValues(25),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`setup-role:remove:${guildId}`)
          .setPlaceholder(t(locale, "setup", excludedRoleIds.length ? "panelRemoveExcludedRoles" : "noExcludedRoles"))
          .setDefaultRoles(excludedRoleIds.slice(0, 25))
          .setDisabled(excludedRoleIds.length === 0)
          .setMinValues(1).setMaxValues(25),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup-modal:timeout:${guildId}`).setLabel(t(locale, "setup", "panelTimeout")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`setup-modal:addServer:${guildId}`).setLabel(t(locale, "setup", "panelAddBlockedServer")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`setup-modal:removeServer:${guildId}`).setLabel(t(locale, "setup", "panelRemoveBlockedServer")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`setup-page:main:${guildId}`).setLabel(t(locale, "setup", "panelBack")).setStyle(ButtonStyle.Primary),
      ));
      const roleSummary = formatExcludedRoles(interaction, excludedRoleIds, excludedAdministrators);
      const blockSummary = blockedIds.length > 8
        ? `${blockedIds.slice(0, 8).join(", ")} ${t(locale, "setup", "andMore", blockedIds.length - 8)}`
        : blockedIds.length ? blockedIds.join(", ") : t(locale, "setup", "noMaliciousServers");
      content = [
        t(locale, "setup", "panelAdvancedDescription"),
        channelId ? t(locale, "setup", "currentSet", channelId) : t(locale, "setup", "notConfigured"),
        t(locale, "setup", "currentTimeout", formatTimeoutMinutes(timeoutMs)),
        t(locale, "setup", "currentExcludedRoles", roleSummary),
        t(locale, "setup", "panelBlockedServersStatus", blockSummary),
      ].join("\n");
    }

    return {
      content: notice ? `${notice}\n\n${content}` : content,
      components: rows,
      ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    };
  }

  function isAuthorized(interaction) {
    return interaction.inGuild() && (
      interaction.guild?.ownerId === interaction.user?.id
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    );
  }

  async function denyUnauthorized(interaction) {
    await interaction.reply({
      content: t(resolveLocale(interaction), "setup", interaction.inGuild() ? "manageServerRequired" : "onlyInServer"),
      flags: MessageFlags.Ephemeral,
    });
  }

  async function rejectWrongServer(interaction, guildId) {
    if (guildId === interaction.guildId) return false;
    await interaction.reply({ content: t(resolveLocale(interaction), "setup", "panelWrongServer"), flags: MessageFlags.Ephemeral });
    return true;
  }

  function makeModal(kind, guildId, locale) {
    const timeout = kind === "timeout";
    const modal = new ModalBuilder()
      .setCustomId(`setup-modal-submit:${kind}:${guildId}`)
      .setTitle(t(locale, "setup", timeout ? "modalTimeoutTitle" : kind === "addServer" ? "modalAddServerTitle" : "modalRemoveServerTitle"));
    const input = new TextInputBuilder()
      .setCustomId("value")
      .setLabel(t(locale, "setup", timeout ? "modalTimeoutLabel" : "modalServerIdLabel"))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder(t(locale, "setup", timeout ? "modalTimeoutPlaceholder" : "modalServerIdPlaceholder"));
    if (timeout) input.setMinLength(1).setMaxLength(5);
    else input.setMinLength(17).setMaxLength(20);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
  }

  return async function handleSetupCommand(interaction) {
    const locale = resolveLocale(interaction);

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith("setup-modal-submit:")) {
      if (!isAuthorized(interaction)) return denyUnauthorized(interaction);
      const [, kind, guildId] = interaction.customId.split(":");
      if (await rejectWrongServer(interaction, guildId)) return;
      const rawValue = interaction.fields.getTextInputValue("value").trim();
      let notice;
      if (kind === "timeout") {
        const minutes = Number(rawValue);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320) {
          await interaction.reply({ content: t(locale, "setup", "invalidTimeout"), flags: MessageFlags.Ephemeral });
          return;
        }
        await settingsStore.setTimeoutMs(guildId, minutes * 60_000);
        notice = t(locale, "setup", "timeoutSaved", minutes);
      } else {
        if (!isDiscordGuildId(rawValue)) {
          await interaction.reply({ content: t(locale, "setup", "maliciousServerIdInvalid"), flags: MessageFlags.Ephemeral });
          return;
        }
        const listed = settingsStore.getMaliciousServerProtection(guildId).blockedGuildIds.includes(rawValue);
        if (kind === "addServer") {
          if (listed) {
            await interaction.reply({ content: t(locale, "setup", "maliciousServerAlreadyListed", rawValue), flags: MessageFlags.Ephemeral });
            return;
          }
          await settingsStore.addBlockedGuildId(guildId, rawValue);
          notice = t(locale, "setup", "maliciousServerAdded", rawValue);
        } else if (kind === "removeServer") {
          if (!listed) {
            await interaction.reply({ content: t(locale, "setup", "maliciousServerNotListed", rawValue), flags: MessageFlags.Ephemeral });
            return;
          }
          await settingsStore.removeBlockedGuildId(guildId, rawValue);
          notice = t(locale, "setup", "maliciousServerRemoved", rawValue);
        } else {
          await interaction.reply({ content: t(locale, "setup", "panelInvalidSelection"), flags: MessageFlags.Ephemeral });
          return;
        }
      }
      await interaction.reply(createSettingsPanel(guildId, locale, "advanced", true, notice, interaction));
      return;
    }

    if (interaction.isButton?.() && interaction.customId.startsWith("setup-")) {
      if (!isAuthorized(interaction)) return denyUnauthorized(interaction);
      const parts = interaction.customId.split(":");
      const [prefix, key, guildId] = parts;
      if (await rejectWrongServer(interaction, guildId)) return;
      if (prefix === "setup-page") {
        await interaction.update(createSettingsPanel(guildId, locale, key, false, null, interaction));
        return;
      }
      if (prefix === "setup-modal") {
        await interaction.showModal(makeModal(key, guildId, locale));
        return;
      }
      if (prefix !== "setup-toggle") return;

      switch (key) {
        case "raid": {
          const current = settingsStore.getRaidProtection(guildId);
          await settingsStore.setRaidProtection(guildId, !current.enabled, current.level);
          break;
        }
        case "spam": await settingsStore.setSpamProtection(guildId, !settingsStore.getSpamProtection(guildId).enabled); break;
        case "links": await settingsStore.setBlockedLinkProtection(guildId, !settingsStore.getBlockedLinkProtection(guildId).enabled); break;
        case "malicious": await settingsStore.setMaliciousServerProtection(guildId, !settingsStore.getMaliciousServerProtection(guildId).enabled); break;
        case "nsfw": await settingsStore.setNsfwServerProtection(guildId, !settingsStore.getNsfwServerProtection(guildId).enabled); break;
        case "bots": await settingsStore.setBotDetection(guildId, !settingsStore.getBotDetection(guildId).enabled); break;
        case "antiNovaVoidBox": await settingsStore.setAntiNovaVoidBox(guildId, !settingsStore.getAntiNovaVoidBox(guildId).enabled); break;
        case "textRemoteJobs": {
          const current = settingsStore.getTextScamProtection(guildId);
          await settingsStore.setTextScamProtection(guildId, { remoteJobs: !current.remoteJobs });
          break;
        }
        case "textGiveaways": {
          const current = settingsStore.getTextScamProtection(guildId);
          await settingsStore.setTextScamProtection(guildId, { giveaways: !current.giveaways });
          break;
        }
        case "excludedAdministrators":
          await settingsStore.setExcludedAdministrators(guildId, !settingsStore.getExcludedAdministrators(guildId));
          break;
        default:
          await interaction.reply({ content: t(locale, "setup", "panelInvalidButton"), flags: MessageFlags.Ephemeral });
          return;
      }
      await interaction.update(createSettingsPanel(guildId, locale, "main", false, null, interaction));
      return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith("setup-select:")) {
      if (!isAuthorized(interaction)) return denyUnauthorized(interaction);
      const [, key, guildId] = interaction.customId.split(":");
      if (await rejectWrongServer(interaction, guildId)) return;
      const value = interaction.values[0];
      if (key === "paranoia" && Object.values(PARANOIA_LEVELS).includes(value)) {
        await settingsStore.setParanoiaLevel(guildId, value);
      } else if (key === "raid" && Object.values(RAID_LEVELS).includes(value)) {
        const current = settingsStore.getRaidProtection(guildId);
        await settingsStore.setRaidProtection(guildId, current.enabled, value);
      } else if (key === "dmPolicy" && Object.values(DM_POLICIES).includes(value)) {
        await settingsStore.setTextScamProtection(guildId, { dmPolicy: value });
      } else {
        await interaction.reply({ content: t(locale, "setup", "panelInvalidSelection"), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.update(createSettingsPanel(guildId, locale, key === "dmPolicy" ? "advanced" : "main", false, null, interaction));
      return;
    }

    if (interaction.isChannelSelectMenu?.() && interaction.customId.startsWith("setup-channel:")) {
      if (!isAuthorized(interaction)) return denyUnauthorized(interaction);
      const [, key, guildId] = interaction.customId.split(":");
      if (await rejectWrongServer(interaction, guildId)) return;
      if (key !== "moderation" || !interaction.values[0]) {
        await interaction.reply({ content: t(locale, "setup", "panelInvalidSelection"), flags: MessageFlags.Ephemeral });
        return;
      }
      const channel = await interaction.guild.channels.fetch(interaction.values[0]);
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      const botPermissions = channel?.permissionsFor(botMember);
      if (!channel?.isTextBased() || !channel.isSendable() || !botPermissions?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
      ])) {
        await interaction.reply({ content: t(locale, "setup", "missingBotPermissions"), flags: MessageFlags.Ephemeral });
        return;
      }
      await settingsStore.setModerationChannelId(guildId, channel.id);
      await interaction.update(createSettingsPanel(guildId, locale, "advanced", false, null, interaction));
      return;
    }

    if (interaction.isRoleSelectMenu?.() && interaction.customId.startsWith("setup-role:")) {
      if (!isAuthorized(interaction)) return denyUnauthorized(interaction);
      const [, action, guildId] = interaction.customId.split(":");
      if (await rejectWrongServer(interaction, guildId)) return;
      const excluded = new Set(settingsStore.getExcludedRoleIds(guildId));
      if (action === "add") {
        await Promise.all(interaction.values.map((roleId) => settingsStore.addExcludedRoleId(guildId, roleId)));
      } else if (action === "remove") {
        await Promise.all(interaction.values.filter((roleId) => excluded.has(roleId)).map((roleId) => settingsStore.removeExcludedRoleId(guildId, roleId)));
      } else {
        await interaction.reply({ content: t(locale, "setup", "panelInvalidSelection"), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.update(createSettingsPanel(guildId, locale, "advanced", false, null, interaction));
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "spam") {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: t(locale, "setup", "onlyInServer"), flags: MessageFlags.Ephemeral });
        return;
      }
      const canViewAnalytics = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      if (!canViewAnalytics) {
        await interaction.reply({ content: t(locale, "setup", "analyticsPermissionRequired"), flags: MessageFlags.Ephemeral });
        return;
      }
      const analyticsScope = interaction.options.getSubcommand();
      if (analyticsScope !== "analytics" && analyticsScope !== "global") return;
      if (config.sendFeedback === false) {
        await interaction.reply({ content: t(locale, "setup", "analyticsDisabled"), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({
        content: analyticsScope === "global"
          ? formatAnalytics(locale, analytics?.getGlobalSnapshot?.() ?? createEmptyAnalyticsSnapshot(), true)
          : formatAnalytics(locale, analytics?.getSnapshot?.(interaction.guildId) ?? createEmptyAnalyticsSnapshot()),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName !== "setup") return;
    if (!interaction.inGuild()) {
      await interaction.reply({ content: t(locale, "setup", "onlyInServer"), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isAuthorized(interaction)) {
      await interaction.reply({ content: t(locale, "setup", "manageServerRequired"), flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() !== "panel") return;
    await interaction.reply(createSettingsPanel(interaction.guildId, locale, "main", true, null, interaction));
  };
}

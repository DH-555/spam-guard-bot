import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  createSetupCommandHandler,
  registerSetupCommandForGuild,
} from "../src/setup-command.js";

function createAnalyticsSnapshot() {
  return {
    detections: {
      blockedLink: 1,
      textScam: 2,
      maliciousServerInvite: 3,
      nsfwServerInvite: 4,
      raid: 5,
      spamMessage: 6,
      imageOcr: 7,
      imageVisual: 8,
      imageKnownChannel: 9,
      imageMaliciousServerInvite: 10,
    },
    feedback: { correct: 11, false: 12 },
    manualSpamReports: 13,
  };
}

function createAnalyticsInteraction(hasPermission) {
  const replies = [];
  return {
    replies,
    commandName: "spam",
    guildLocale: "es-ES",
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: {
      has: (permission) => hasPermission && permission === PermissionFlagsBits.ManageMessages,
    },
    options: {
      getSubcommand: () => "analytics",
    },
    reply: async (payload) => replies.push(payload),
  };
}

test("registers /setup as a panel and keeps analytics as a separate command", async () => {
  let commands;
  await registerSetupCommandForGuild({
    commands: {
      set: async (registeredCommands) => {
        commands = registeredCommands;
      },
    },
  });

  assert.deepEqual(commands.map((command) => command.name), ["setup", "spam"]);
  assert.deepEqual(commands[1].options.map((option) => option.name), ["analytics"]);
  assert.deepEqual(commands[0].options.map((option) => option.name), ["panel"]);
  assert.equal(commands[0].description_localizations["es-ES"], "Abre el panel de configuración del servidor.");
});

test("opens the Spanish panel with protection buttons and sensitivity dropdowns", async () => {
  const replies = [];
  const updates = [];
  const settingsStore = {
    getRaidProtection: () => ({ enabled: true, level: "high" }),
    getSpamProtection: () => ({ enabled: true }),
    getBlockedLinkProtection: () => ({ enabled: true }),
    getMaliciousServerProtection: () => ({ enabled: true, blockedGuildIds: [] }),
    getNsfwServerProtection: () => ({ enabled: true }),
    getBotDetection: () => ({ enabled: false }),
    getTextScamProtection: () => ({ remoteJobs: true, giveaways: true, dmPolicy: "recent" }),
    getParanoiaLevel: () => "high",
    getExcludedAdministrators: () => true,
    getModerationChannelId: () => null,
    getTimeoutMs: () => null,
    getExcludedRoleIds: () => [],
  };
  const handler = createSetupCommandHandler({
    config: { timeoutMs: 60_000 },
    settingsStore,
  });
  const interaction = {
    commandName: "setup",
    guildId: "guild-1",
    guild: { roles: { cache: new Map() } },
    guildLocale: "es-ES",
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => "panel",
    },
    reply: async (payload) => replies.push(payload),
    update: async (payload) => updates.push(payload),
  };

  await handler(interaction);

  assert.match(replies[0].content, /Configuración de protección del servidor/);
  const components = replies[0].components.flatMap((row) => row.components);
  const botButton = components.find((component) => component.data.custom_id === "setup-toggle:bots:guild-1");
  assert.match(botButton.data.label, /Detección de bots: DESACTIVADO/);
  const paranoiaMenu = components.find((component) => component.data.custom_id === "setup-select:paranoia:guild-1");
  assert.deepEqual(paranoiaMenu.options.map((option) => option.data.label), ["bajo", "medio", "alto", "extremo"]);

  await handler({
    ...interaction,
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: "setup-page:advanced:guild-1",
  });

  assert.match(updates[0].content, /Ajustes adicionales de este servidor/);
  assert.equal(updates[0].components.length, 5);
  const advancedComponents = updates[0].components.flatMap((row) => row.components);
  assert.ok(advancedComponents.some((component) => component.data.placeholder === "Canal de avisos de moderación"));
  assert.ok(advancedComponents.some((component) => component.data.placeholder === "Política de mensajes privados: Rechazar cuentas con menos de 7 días"));
  assert.ok(advancedComponents.some((component) => component.data.custom_id === "setup-role:add:guild-1"));
  assert.ok(advancedComponents.some((component) => component.data.label === "Configurar duración del timeout"));
});

test("shows global analytics only to moderators and administrators", async () => {
  const handler = createSetupCommandHandler({
    config: { sendFeedback: true },
    analytics: { getSnapshot: () => createAnalyticsSnapshot() },
  });
  const authorized = createAnalyticsInteraction(true);

  await handler(authorized);

  assert.equal(authorized.replies.length, 1);
  assert.match(authorized.replies[0].content, /todos los servidores/i);
  assert.match(authorized.replies[0].content, /Detecciones totales: 55/);

  const unauthorized = createAnalyticsInteraction(false);
  await handler(unauthorized);

  assert.equal(unauthorized.replies.length, 1);
  assert.match(unauthorized.replies[0].content, /Necesitas permiso/i);
});

test("does not show analytics when SEND_FEEDBACK is disabled", async () => {
  let snapshotCalls = 0;
  const handler = createSetupCommandHandler({
    config: { sendFeedback: false },
    analytics: {
      getSnapshot: () => {
        snapshotCalls += 1;
        return createAnalyticsSnapshot();
      },
    },
  });
  const interaction = createAnalyticsInteraction(true);

  await handler(interaction);

  assert.equal(snapshotCalls, 0);
  assert.match(interaction.replies[0].content, /desactivado/i);
});

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

test("registers /spam analytics alongside /setup", async () => {
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
  assert.ok(commands[0].options.some((option) => option.name === "bot-detection"));
});

test("configures bot message detection per server", async () => {
  let saved;
  const replies = [];
  const handler = createSetupCommandHandler({
    config: { timeoutMs: 60_000 },
    settingsStore: {
      setBotDetection: async (guildId, enabled) => {
        saved = { guildId, enabled };
      },
    },
  });
  const interaction = {
    commandName: "setup",
    guildId: "guild-1",
    guildLocale: "es-ES",
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => "bot-detection",
      getSubcommandGroup: () => null,
      getBoolean: () => true,
    },
    reply: async (payload) => replies.push(payload),
  };

  await handler(interaction);

  assert.deepEqual(saved, { guildId: "guild-1", enabled: true });
  assert.match(replies[0].content, /detección y moderación de mensajes de bots está activada/i);
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

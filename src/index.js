import "dotenv/config";
import { resolve } from "node:path";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { loadConfig } from "./config.js";
import { createMessageHandler } from "./moderation.js";
import { resolveLocale, t } from "./i18n.js";
import { OcrService } from "./ocr.js";
import { SettingsStore } from "./settings-store.js";
import {
  buildVisualReferenceMatcher,
  loadVisualReferenceManifest,
} from "./visual-matching.js";
import {
  buildEasterEggMatcher,
  loadEasterEggPhotoManifest,
} from "./easter-egg-matching.js";
import {
  createSetupCommandHandler,
  registerSetupCommandForGuild,
  registerSetupCommands,
} from "./setup-command.js";

const config = loadConfig();
const ocrService = new OcrService(config.ocrCachePath, {
  effort: config.ocrEffort,
});
const settingsStore = new SettingsStore(resolve("data/settings.json"));
await settingsStore.load();

const visualReferenceHashes = await loadVisualReferenceManifest(
  config.visualReferenceManifestPath,
);
const visualMatcher = visualReferenceHashes.length > 0
  ? await buildVisualReferenceMatcher(
      visualReferenceHashes,
      config.visualMatchThreshold,
      { maxImagePixels: config.maxImagePixels },
  )
  : null;
const easterEggReferences = await loadEasterEggPhotoManifest(
  config.easterEggPhotoManifestPath,
);
const easterEggMatcher = easterEggReferences.length > 0
  ? await buildEasterEggMatcher(
      easterEggReferences,
      0,
      { maxImagePixels: config.maxImagePixels },
    )
  : null;

if (visualReferenceHashes.length === 0) {
  console.warn(
    `[Visual matching] No reference hashes found at ${config.visualReferenceManifestPath}.`,
  );
} else if (visualReferenceHashes.length > 0) {
  console.log(
    `[Visual matching] Loaded ${visualReferenceHashes.length} reference hash(es).`,
  );
}

if (easterEggReferences.length === 0) {
  console.warn(
    `[Easter eggs] No hash signatures found at ${config.easterEggPhotoManifestPath}.`,
  );
} else {
  console.log(
    `[Easter eggs] Loaded ${easterEggReferences.length} hash signature(s).`,
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const handleMessage = createMessageHandler({
  client,
  config,
  ocrService,
  settingsStore,
  visualMatcher,
  easterEggMatcher,
});
const handleSetupCommand = createSetupCommandHandler({ settingsStore, config });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot connected as ${readyClient.user.tag}.`);

  try {
    await registerSetupCommands(readyClient);
    console.log("Setup commands registered.");
  } catch (error) {
    console.error("[Discord] Could not register setup commands:", error);
  }
});

client.on(Events.GuildCreate, (guild) => {
  void registerSetupCommandForGuild(guild).catch((error) => {
    console.error(
      `[Discord] Could not register setup commands in guild ${guild.id}:`,
      error,
    );
  });
});

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message).catch((error) => {
    console.error(
      `[Moderation] Failed to process message ${message.id}:`,
      error,
    );
  });
});

client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
  void handleMessage(newMessage).catch((error) => {
    console.error(
      `[Moderation] Failed to process updated message ${newMessage.id}:`,
      error,
    );
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleSetupCommand(interaction).catch((error) => {
    console.error("[Discord] Failed to process setup command:", error);

    const response = {
      content: t(resolveLocale(interaction), "setup", "configError"),
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
      void interaction.followUp(response);
    } else if (interaction.isRepliable()) {
      void interaction.reply(response);
    }
  });
});

client.on(Events.Error, (error) => {
  console.error("[Discord] Client error:", error);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  client.destroy();
  await ocrService.terminate();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.discordToken);

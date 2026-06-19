import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../src/settings-store.js";

test("stores moderation channels separately for each guild", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anti-mr-scam-"));
  const filePath = join(directory, "settings.json");
  const store = new SettingsStore(filePath);

  await store.load();
  await store.setModerationChannelId("guild-1", "channel-1");
  await store.setModerationChannelId("guild-2", "channel-2");

  assert.equal(store.getModerationChannelId("guild-1"), "channel-1");
  assert.equal(store.getModerationChannelId("guild-2"), "channel-2");

  const savedSettings = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(savedSettings["guild-1"].moderationChannelId, "channel-1");
});

test("loads previously saved settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anti-mr-scam-"));
  const filePath = join(directory, "settings.json");
  const firstStore = new SettingsStore(filePath);

  await firstStore.load();
  await firstStore.setModerationChannelId("guild-1", "channel-1");

  const secondStore = new SettingsStore(filePath);
  await secondStore.load();

  assert.equal(secondStore.getModerationChannelId("guild-1"), "channel-1");
  assert.equal(secondStore.getModerationChannelId("unknown"), null);
});

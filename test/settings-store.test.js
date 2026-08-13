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
  await store.setParanoiaLevel("guild-1", "low");
  await store.setParanoiaLevel("guild-2", "medium");
  await store.setTimeoutMs("guild-1", 5 * 60_000);
  await store.addExcludedRoleId("guild-1", "role-1");
  await store.addExcludedRoleId("guild-1", "role-2");
  await store.addExcludedRoleId("guild-1", "role-1");
  await store.addBlockedGuildId("guild-1", "123456789012345678");
  await store.addBlockedGuildId("guild-1", "123456789012345679");
  await store.addBlockedGuildId("guild-1", "123456789012345678");
  assert.equal(store.getExcludedAdministrators("guild-1"), true);
  await store.setSpamProtection("guild-1", false);
  await store.setMaliciousServerProtection("guild-1", false);
  await store.setNsfwServerProtection("guild-1", false);
  assert.deepEqual(store.getSpamProtection("guild-1"), { enabled: false });
  assert.deepEqual(store.getMaliciousServerProtection("guild-1"), {
    enabled: false,
    blockedGuildIds: ["123456789012345678", "123456789012345679"],
  });
  assert.deepEqual(store.getNsfwServerProtection("guild-1"), { enabled: false });

  assert.equal(store.getModerationChannelId("guild-1"), "channel-1");
  assert.equal(store.getModerationChannelId("guild-2"), "channel-2");
  assert.equal(store.getParanoiaLevel("guild-1"), "low");
  assert.equal(store.getParanoiaLevel("guild-2"), "medium");
  assert.equal(store.getTimeoutMs("guild-1"), 5 * 60_000);
  assert.deepEqual(store.getExcludedRoleIds("guild-1"), ["role-1", "role-2"]);

  const savedSettings = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(savedSettings["guild-1"].moderationChannelId, "channel-1");
  assert.equal(savedSettings["guild-1"].paranoiaLevel, "low");
  assert.equal(savedSettings["guild-1"].timeoutMs, 5 * 60_000);
  assert.deepEqual(savedSettings["guild-1"].excludedRoleIds, ["role-1", "role-2"]);
  assert.equal(savedSettings["guild-1"].excludedAdministrators, undefined);
  assert.equal(savedSettings["guild-1"].spamProtection.enabled, false);
  assert.equal(savedSettings["guild-1"].maliciousServerProtection.enabled, false);
  assert.deepEqual(savedSettings["guild-1"].maliciousServerProtection.blockedGuildIds, [
    "123456789012345678",
    "123456789012345679",
  ]);
});

test("loads previously saved settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anti-mr-scam-"));
  const filePath = join(directory, "settings.json");
  const firstStore = new SettingsStore(filePath);

  await firstStore.load();
  await firstStore.setModerationChannelId("guild-1", "channel-1");
  await firstStore.setParanoiaLevel("guild-1", "high");
  await firstStore.setTimeoutMs("guild-1", 15 * 60_000);
  await firstStore.addExcludedRoleId("guild-1", "role-1");
  await firstStore.setExcludedAdministrators("guild-1", false);
  await firstStore.addBlockedGuildId("guild-1", "123456789012345678");

  const secondStore = new SettingsStore(filePath);
  await secondStore.load();

  assert.equal(secondStore.getModerationChannelId("guild-1"), "channel-1");
  assert.equal(secondStore.getParanoiaLevel("guild-1"), "high");
  assert.equal(secondStore.getTimeoutMs("guild-1"), 15 * 60_000);
  assert.deepEqual(secondStore.getExcludedRoleIds("guild-1"), ["role-1"]);
  assert.equal(secondStore.getExcludedAdministrators("guild-1"), false);
  assert.deepEqual(secondStore.getSpamProtection("guild-1"), { enabled: true });
  assert.deepEqual(secondStore.getMaliciousServerProtection("guild-1"), {
    enabled: true,
    blockedGuildIds: ["123456789012345678"],
  });
  assert.deepEqual(secondStore.getNsfwServerProtection("guild-1"), { enabled: true });
  assert.equal(secondStore.getModerationChannelId("unknown"), null);
  assert.equal(secondStore.getParanoiaLevel("unknown"), "high");
  assert.equal(secondStore.getTimeoutMs("unknown"), null);
  assert.deepEqual(secondStore.getExcludedRoleIds("unknown"), []);
  assert.equal(secondStore.getExcludedAdministrators("unknown"), true);
  assert.deepEqual(secondStore.getMaliciousServerProtection("unknown"), {
    enabled: true,
    blockedGuildIds: [],
  });
  assert.deepEqual(secondStore.getNsfwServerProtection("unknown"), { enabled: true });
});

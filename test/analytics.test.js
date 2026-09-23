import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AnalyticsStore } from "../src/analytics.js";

test("persists per-server and global aggregate counters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anti-mr-scam-analytics-"));
  const filePath = join(directory, "analytics.json");
  const store = new AnalyticsStore(filePath);
  const guildId = "123456789012345678";

  await store.load();
  await store.recordDetection(guildId, "imageOcr");
  await store.recordDetection(guildId, "imageOcr");
  await store.recordDetection(guildId, "blockedLink");
  await store.recordFeedback(guildId, "true");
  await store.recordFeedback(guildId, "false");
  await store.recordManualSpamReport(guildId);

  const snapshot = {
    detections: {
      blockedLink: 1,
      textScam: 0,
      maliciousServerInvite: 0,
      nsfwServerInvite: 0,
      raid: 0,
      spamMessage: 0,
      imageOcr: 2,
      imageVisual: 0,
      imageKnownChannel: 0,
      imageMaliciousServerInvite: 0,
    },
    feedback: { correct: 1, false: 1 },
    manualSpamReports: 1,
  };
  assert.deepEqual(store.getSnapshot(guildId), snapshot);
  assert.deepEqual(store.getGlobalSnapshot(), snapshot);

  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.deepEqual(saved, {
    version: 3,
    global: snapshot,
    servers: { [guildId]: snapshot },
  });
  assert.deepEqual(Object.keys(saved), ["version", "global", "servers"]);
  assert.deepEqual(Object.keys(saved.servers[guildId]), ["detections", "feedback", "manualSpamReports"]);
});

test("does not collect or expose analytics when disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anti-mr-scam-analytics-"));
  const filePath = join(directory, "analytics.json");
  const store = new AnalyticsStore(filePath, false);
  const guildId = "123456789012345678";

  await store.load();
  await store.recordDetection(guildId, "imageOcr");
  await store.recordFeedback(guildId, "true");
  await store.recordManualSpamReport(guildId);

  assert.equal(store.isEnabled(), false);
  assert.equal(store.getSnapshot(), null);
  await assert.rejects(readFile(filePath, "utf8"), { code: "ENOENT" });
});

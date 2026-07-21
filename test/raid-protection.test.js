import test from "node:test";
import assert from "node:assert/strict";
import { RaidTracker, raidThreshold } from "../src/raid-protection.js";

function entry(channelId, content = "same message") {
  return { guildId: "guild", userId: "user", channelId, content, message: { content } };
}

test("uses the configured anti-raid thresholds", () => {
  assert.equal(raidThreshold("high"), 3);
  assert.equal(raidThreshold("medium"), 4);
  assert.equal(raidThreshold("low", 8), 8);
});

test("counts distinct channels and triggers at high level", () => {
  const tracker = new RaidTracker();
  assert.equal(tracker.record({ ...entry("one"), level: "high" }), null);
  assert.equal(tracker.record({ ...entry("one"), level: "high" }), null);
  const result = tracker.record({ ...entry("two"), level: "high" });
  assert.equal(result, null);
  const triggered = tracker.record({ ...entry("three"), level: "high" });
  assert.equal(triggered.length, 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("enables feedback by default and accepts SEND_FEEDBACK=false", () => {
  const previousToken = process.env.DISCORD_TOKEN;
  const previousSendFeedback = process.env.SEND_FEEDBACK;

  try {
    process.env.DISCORD_TOKEN = "test-token";
    delete process.env.SEND_FEEDBACK;
    assert.equal(loadConfig().sendFeedback, true);

    process.env.SEND_FEEDBACK = "false";
    assert.equal(loadConfig().sendFeedback, false);

    process.env.SEND_FEEDBACK = "true";
    assert.equal(loadConfig().sendFeedback, true);
  } finally {
    if (previousToken === undefined) {
      delete process.env.DISCORD_TOKEN;
    } else {
      process.env.DISCORD_TOKEN = previousToken;
    }

    if (previousSendFeedback === undefined) {
      delete process.env.SEND_FEEDBACK;
    } else {
      process.env.SEND_FEEDBACK = previousSendFeedback;
    }
  }
});

test("rejects invalid SEND_FEEDBACK values", () => {
  const previousToken = process.env.DISCORD_TOKEN;
  const previousSendFeedback = process.env.SEND_FEEDBACK;

  try {
    process.env.DISCORD_TOKEN = "test-token";
    process.env.SEND_FEEDBACK = "0";
    assert.throws(() => loadConfig(), /SEND_FEEDBACK must be either true or false/);
  } finally {
    if (previousToken === undefined) {
      delete process.env.DISCORD_TOKEN;
    } else {
      process.env.DISCORD_TOKEN = previousToken;
    }

    if (previousSendFeedback === undefined) {
      delete process.env.SEND_FEEDBACK;
    } else {
      process.env.SEND_FEEDBACK = previousSendFeedback;
    }
  }
});

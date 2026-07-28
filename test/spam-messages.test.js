import test from "node:test";
import assert from "node:assert/strict";
import { findSpamMessage, normalizeSpamText } from "../src/spam-messages.js";

test("normalizes spam text and matches a listed phrase", () => {
  assert.equal(normalizeSpamText("  ¡PREMIO!  "), "¡premio!");
  assert.equal(findSpamMessage("Congratulations!   You have won a PRIZE. Click here to claim it."), "Congratulations! You have won a prize. Click here to claim it.");
});

test("does not match messages outside the list", () => {
  assert.equal(findSpamMessage("This is a normal conversation."), null);
  assert.equal(findSpamMessage("Free crypto giveaway!", ["free crypto giveaway now"]), null);
});

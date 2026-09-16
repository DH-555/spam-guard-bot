import test from "node:test";
import assert from "node:assert/strict";
import { findSpamMessage, getMessageText, getSpamText, normalizeSpamText } from "../src/spam-messages.js";

test("normalizes spam text and matches a listed phrase", () => {
  assert.equal(normalizeSpamText("  ¡PREMIO!  "), "¡premio!");
  assert.equal(findSpamMessage("Congratulations!   You have won a PRIZE. Click here to claim it."), "Congratulations! You have won a prize. Click here to claim it.");
});

test("does not match messages outside the list", () => {
  assert.equal(findSpamMessage("This is a normal conversation."), null);
  assert.equal(findSpamMessage("Free crypto giveaway!", ["free crypto giveaway now"]), null);
});

test("matches promotional NSFW descriptions but ignores negated NSFW rules", () => {
  const rules = {
    messages: [],
    descriptionPatterns: ["\\bnsfw\\s+(?:content|gifs?)\\b"],
    descriptionExclusions: ["\\bnsfw\\s+not\\s+allowed\\b"],
  };

  assert.ok(findSpamMessage("A server with NSFW content including 3000+ NSFW GIFs", rules));
  assert.equal(findSpamMessage("NSFW not allowed here", rules), null);

  assert.ok(findSpamMessage(
    "Anime Empire is an Adult NSFW, Roleplay & Anime Community where all the weebs can unite!",
    {
      messages: [],
      descriptionPatterns: ["\\badult\\s+nsfw\\b"],
      descriptionExclusions: [],
    },
  ));
});

test("includes embed and forwarded snapshot descriptions", () => {
  const message = {
    content: "",
    embeds: [{ description: "server description" }],
    messageSnapshots: new Map([
      ["snapshot", { embeds: [{ description: "forwarded description" }] }],
    ]),
  };

  assert.equal(getSpamText(message), "server description\nforwarded description");
});

test("includes forwarded message content and embed URLs in the shared text", () => {
  const message = {
    content: "outer message",
    embeds: [],
    messageSnapshots: new Map([
      ["snapshot", {
        content: "forwarded message https://surveybuilder.io/c/capture/mhnkqthus3a",
        embeds: [{ url: "https://agentrouter.org/register?aff=qaiK" }],
        messageSnapshots: new Map(),
      }],
    ]),
  };

  const text = getMessageText(message);
  assert.match(text, /forwarded message/);
  assert.match(text, /surveybuilder\.io/);
  assert.match(text, /agentrouter\.org/);
});

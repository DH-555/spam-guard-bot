import test from "node:test";
import assert from "node:assert/strict";
import { getTrustedImageUrls, isTrustedImageUrl } from "../src/images.js";
import { escapeDiscordMarkdown, sanitizeLogText, sanitizeText } from "../src/security.js";

test("sanitizes control characters and Discord markdown", () => {
  const input = "alert" + String.fromCharCode(0) + "\n**[click](https://evil.example)** <@everyone> " +
    String.fromCharCode(96) + "code" + String.fromCharCode(96);
  const sanitized = escapeDiscordMarkdown(input, 200);

  assert.equal(sanitized.includes(String.fromCharCode(0)), false);
  assert.equal(sanitized.includes("**"), false);
  assert.equal(sanitized.includes("[click]"), false);
  assert.equal(sanitized.includes("<@everyone>"), false);
  assert.equal(sanitized.includes(String.fromCharCode(96) + "code" + String.fromCharCode(96)), false);
  assert.equal(sanitizeText(input).includes(String.fromCharCode(0)), false);
  assert.equal(sanitizeLogText("first\nsecond\r\nthird"), "first second third");
});

test("keeps only trusted Discord image URLs for outbound reports", () => {
  const trusted = "https://cdn.discordapp.com/attachments/123/image.png";
  const proxy = "https://media.discordapp.net/attachments/123/image.png";

  assert.deepEqual(
    getTrustedImageUrls([trusted, "https://evil.example/payload.png", proxy, trusted]),
    [trusted, proxy],
  );
  assert.equal(isTrustedImageUrl("https://evil.example/payload.png"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createMessageHandler } from "../src/moderation.js";
import {
  buildVisualReferenceMatcher,
  loadVisualReferenceManifest,
  writeVisualReferenceManifest,
} from "../src/visual-matching.js";

function createHorizontalGradient(width, height, reversed = false) {
  const pixels = Buffer.alloc(width * height * 3);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = reversed
        ? Math.round(255 * (1 - column / (width - 1)))
        : Math.round(255 * (column / (width - 1)));
      const offset = (row * width + column) * 3;
      pixels.fill(value, offset, offset + 3);
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

test("moderates and posts a fallback notice when no moderation channel is configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" ? "4" : null;
      },
    },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) {
              return { done: true, value: undefined };
            }

            done = true;
            return { done: false, value: new Uint8Array([1, 2, 3, 4]) };
          },
          async cancel() {},
        };
      },
    },
  });

  try {
    const channelMessages = [];
    const message = {
      id: "message-1",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-1",
        tag: "tester#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-1>",
      },
      channel: {
        isTextBased: () => true,
        isSendable: () => true,
        send: async (payload) => {
          channelMessages.push(payload);
        },
      },
      guild: {
        preferredLocale: "es-ES",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: 4,
            url: "https://example.com/proof.png",
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        timeout: async () => {},
      },
      delete: async () => {},
      webhookId: null,
      inGuild: () => true,
    };

    const handleMessage = createMessageHandler({
      client: {},
      config: {
        maxImageBytes: 1024,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => "Withdrawal\nSucceeded",
      },
      settingsStore: {
        getModerationChannelId: () => null,
      },
    });

    await handleMessage(message);

    assert.equal(channelMessages.length, 1);
    assert.match(channelMessages[0].content, /Mensaje borrado: <@user-1>/);
    assert.match(
      channelMessages[0].content,
      /configura un canal de moderación con `\/setup moderation-channel`/,
    );
    assert.deepEqual(channelMessages[0].allowedMentions, {
      users: ["user-1"],
      roles: [],
      repliedUser: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deletes the whole message when only one image matches", async () => {
  const originalFetch = globalThis.fetch;

  const tempDirectory = await mkdtemp(join(tmpdir(), "visual-single-match-"));
  const referencePath = join(tempDirectory, "reference-gradient.png");
  const matchingBuffer = await createHorizontalGradient(32, 32);
  const safeBuffer = await createHorizontalGradient(32, 32, true);
  await sharp(matchingBuffer).toFile(referencePath);

  globalThis.fetch = async (url) => {
    const buffer = url.includes("matching") ? matchingBuffer : safeBuffer;

    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-length"
            ? String(buffer.length)
            : null;
        },
      },
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) {
                return { done: true, value: undefined };
              }

              done = true;
              return { done: false, value: buffer };
            },
            async cancel() {},
          };
        },
      },
    };
  };

  try {
    const manifestPath = join(tempDirectory, "manifest.json");
    await writeVisualReferenceManifest(tempDirectory, manifestPath);
    const references = await loadVisualReferenceManifest(manifestPath);
    const visualMatcher = await buildVisualReferenceMatcher(references, 0);
    const channelMessages = [];
    let deleted = 0;
    let ocrCalls = 0;

    const message = {
      id: "message-2",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-1",
        tag: "tester#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-1>",
      },
      channel: {
        isTextBased: () => true,
        isSendable: () => true,
        send: async (payload) => {
          channelMessages.push(payload);
        },
      },
      guild: {
        preferredLocale: "en-US",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "safe.png",
            contentType: "image/png",
            size: 4,
            url: "https://example.com/safe.png",
          },
        ],
        [
          "attachment-2",
          {
            id: "attachment-2",
            name: "matching.png",
            contentType: "image/png",
            size: 4,
            url: "https://example.com/matching.png",
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        timeout: async () => {},
      },
      delete: async () => {
        deleted += 1;
      },
      webhookId: null,
      inGuild: () => true,
    };

    const handleMessage = createMessageHandler({
      client: {},
      config: {
        maxImageBytes: 1024,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => {
          ocrCalls += 1;
          return "nothing useful";
        },
      },
      settingsStore: {
        getModerationChannelId: () => null,
      },
      visualMatcher,
    });

    await handleMessage(message);

    assert.equal(deleted, 1);
    assert.equal(ocrCalls, 1);
    assert.equal(channelMessages.length, 1);
    assert.match(channelMessages[0].content, /Message deleted: <@user-1>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

function createImageFetchResponse(buffer) {
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
}

function imageUrl(name) {
  return `https://cdn.discordapp.com/attachments/${name}.png`;
}

test("moderates and posts a fallback notice when no moderation channel is configured", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

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
        ownerId: "owner-1",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("proof"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => false,
        },
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
        maxImagePixels: 16_000_000,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => "Withdrawal\nSucceeded",
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => null,
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

    return createImageFetchResponse(buffer);
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
        ownerId: "owner-1",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "safe.png",
            contentType: "image/png",
            size: safeBuffer.length,
            url: imageUrl("safe"),
          },
        ],
        [
          "attachment-2",
          {
            id: "attachment-2",
            name: "matching.png",
            contentType: "image/png",
            size: matchingBuffer.length,
            url: imageUrl("matching"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => false,
        },
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
        maxImagePixels: 16_000_000,
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
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => null,
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

test("ignores guild administrators", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    let deleted = 0;
    let ocrCalls = 0;
    const channelMessages = [];
    const message = {
      id: "message-admin",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-admin",
        tag: "admin#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-admin>",
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
        ownerId: "owner-1",
        members: {
          fetch: async () => {
            throw new Error("should not fetch");
          },
        },
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("proof"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => true,
        },
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
        maxImagePixels: 16_000_000,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => {
          ocrCalls += 1;
          return "Withdrawal\nSucceeded";
        },
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => null,
      },
    });

    await handleMessage(message);

    assert.equal(deleted, 0);
    assert.equal(ocrCalls, 0);
    assert.equal(channelMessages.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("moderates guild administrators when administrator exclusion is disabled", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    let deleted = 0;
    let timeoutValue = null;
    const channelMessages = [];
    const message = {
      id: "message-admin-enabled",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-admin-enabled",
        tag: "admin#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-admin-enabled>",
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
        ownerId: "owner-1",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("proof"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => true,
        },
        timeout: async (value) => {
          timeoutValue = value;
        },
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
        maxImagePixels: 16_000_000,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => "Withdrawal\nSucceeded",
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => false,
        getTimeoutMs: () => null,
      },
    });

    await handleMessage(message);

    assert.equal(deleted, 1);
    assert.equal(timeoutValue, 60_000);
    assert.equal(channelMessages.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ignores members with excluded roles", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    let deleted = 0;
    let ocrCalls = 0;
    const message = {
      id: "message-role-excluded",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-role",
        tag: "role#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-role>",
      },
      channel: {
        isTextBased: () => true,
        isSendable: () => true,
        send: async () => {},
      },
      guild: {
        preferredLocale: "en-US",
        ownerId: "owner-1",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("proof"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => false,
        },
        roles: {
          cache: new Map([["role-1", { id: "role-1" }]]),
        },
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
        maxImagePixels: 16_000_000,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => {
          ocrCalls += 1;
          return "Withdrawal\nSucceeded";
        },
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => ["role-1"],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => null,
      },
    });

    await handleMessage(message);

    assert.equal(deleted, 0);
    assert.equal(ocrCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the server timeout setting when timing out a user", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    let timeoutMs = null;
    const message = {
      id: "message-timeout",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-timeout",
        tag: "timeout#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-timeout>",
      },
      channel: {
        isTextBased: () => true,
        isSendable: () => true,
        send: async () => {},
      },
      guild: {
        preferredLocale: "en-US",
        ownerId: "owner-1",
      },
      attachments: new Map([
        [
          "attachment-1",
          {
            id: "attachment-1",
            name: "proof.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("proof"),
          },
        ],
      ]),
      embeds: [],
      messageSnapshots: new Map(),
      member: {
        moderatable: true,
        permissions: {
          has: () => false,
        },
        timeout: async (value) => {
          timeoutMs = value;
        },
      },
      delete: async () => {},
      webhookId: null,
      inGuild: () => true,
    };

    const handleMessage = createMessageHandler({
      client: {},
      config: {
        maxImageBytes: 1024,
        maxImagePixels: 16_000_000,
        imageDownloadTimeoutMs: 1000,
        timeoutMs: 60_000,
      },
      ocrService: {
        recognize: async () => "Withdrawal\nSucceeded",
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => 15 * 60_000,
      },
    });

    await handleMessage(message);

    assert.equal(timeoutMs, 15 * 60_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

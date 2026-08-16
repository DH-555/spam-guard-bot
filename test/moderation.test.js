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
import {
  buildEasterEggMatcher,
  loadEasterEggPhotoManifest,
  writeEasterEggPhotoManifest,
} from "../src/easter-egg-matching.js";

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

test("blocks a listed spam message without requiring an image", async () => {
  const channelMessages = [];
  let deleted = 0;
  let timeoutCalls = 0;
  const message = {
    id: "spam-message-1",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "FREE CRYPTO GIVEAWAY!  Send crypto to receive double back.",
    author: {
      id: "user-spammer",
      tag: "spammer#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-spammer>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async (payload) => channelMessages.push(payload),
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      bannable: false,
      permissions: { has: () => false },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {},
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => null,
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getSpamProtection: () => ({ enabled: true }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 1);
  assert.equal(timeoutCalls, 1);
  assert.equal(channelMessages.length, 1);
  assert.match(channelMessages[0].content, /Message deleted: <@user-spammer>/);
});

test("deletes malicious server invites, times out the author, and alerts moderators", async () => {
  const moderationMessages = [];
  let deleted = 0;
  let timeoutCalls = 0;
  const moderationChannel = {
    isTextBased: () => true,
    isSendable: () => true,
    send: async (payload) => moderationMessages.push(payload),
  };
  const message = {
    id: "malicious-invite-message",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "Join this server https://discord.gg/malicious",
    author: {
      id: "user-spammer",
      tag: "spammer#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-spammer>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async () => {},
      toString: () => "<#channel-1>",
    },
    guild: { preferredLocale: "es-ES", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {
      fetchInvite: async () => ({ guild: { id: "123456789012345678" } }),
      channels: { fetch: async () => moderationChannel },
    },
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => "moderation-channel",
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getMaliciousServerProtection: () => ({
        enabled: true,
        blockedGuildIds: ["123456789012345678"],
      }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 1);
  assert.equal(timeoutCalls, 1);
  assert.equal(moderationMessages.length, 1);
  assert.match(moderationMessages[0].content, /servidor malicioso/i);
  assert.match(moderationMessages[0].embeds[0].data.fields[2].value, /123456789012345678/);
});

test("does not moderate malicious server invites when protection is disabled", async () => {
  let deleted = 0;
  let timeoutCalls = 0;
  const message = {
    id: "malicious-invite-disabled",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "https://discord.gg/malicious",
    author: {
      id: "user-spammer",
      tag: "spammer#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-spammer>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async () => {},
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: { fetchInvite: async () => ({ guild: { id: "123456789012345678" } }) },
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => null,
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getMaliciousServerProtection: () => ({ enabled: false, blockedGuildIds: ["123456789012345678"] }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 0);
  assert.equal(timeoutCalls, 0);
});

test("blocks invites to servers with NSFW names and alerts moderators", async () => {
  const moderationMessages = [];
  let deleted = 0;
  let timeoutCalls = 0;
  const message = {
    id: "nsfw-invite-message",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "Join: **mailto:/#@discord.gg/nsfw-server**",
    author: {
      id: "user-nsfw",
      tag: "user#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-nsfw>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async () => {},
      toString: () => "<#channel-1>",
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {
      fetchInvite: async () => ({
        guild: { id: "123456789012345678", name: "Official NSFW +18" },
      }),
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          isSendable: () => true,
          send: async (payload) => moderationMessages.push(payload),
        }),
      },
    },
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => "moderation-channel",
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getMaliciousServerProtection: () => ({ enabled: true, blockedGuildIds: [] }),
      getNsfwServerProtection: () => ({ enabled: true }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 1);
  assert.equal(timeoutCalls, 1);
  assert.equal(moderationMessages.length, 1);
  assert.equal(moderationMessages[0].embeds[0].data.title, "NSFW server invite blocked");
  assert.match(moderationMessages[0].embeds[0].data.fields[2].value, /Official NSFW \+18/);
});

test("ignores listed spam messages from members with excluded roles", async () => {
  let deleted = 0;
  let timeoutCalls = 0;
  const channelMessages = [];
  const message = {
    id: "spam-message-excluded-role",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "FREE CRYPTO GIVEAWAY! Send crypto to receive double back.",
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
      send: async (payload) => channelMessages.push(payload),
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      roles: { cache: new Map([["role-1", { id: "role-1" }]]) },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {},
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => null,
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => ["role-1"],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getSpamProtection: () => ({ enabled: true }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 0);
  assert.equal(timeoutCalls, 0);
  assert.equal(channelMessages.length, 0);
});

test("ignores listed spam messages from administrators when configured", async () => {
  let deleted = 0;
  let timeoutCalls = 0;
  const channelMessages = [];
  const message = {
    id: "spam-message-admin",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "FREE CRYPTO GIVEAWAY! Send crypto to receive double back.",
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
      send: async (payload) => channelMessages.push(payload),
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => true },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {},
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => null,
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getSpamProtection: () => ({ enabled: true }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 0);
  assert.equal(timeoutCalls, 0);
  assert.equal(channelMessages.length, 0);
});

test("respects spam protection and moderation settings", async () => {
  let deleted = 0;
  let timeoutValue = null;
  const sourceChannelMessages = [];
  const moderationChannelMessages = [];
  const message = {
    id: "spam-message-settings",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "FREE CRYPTO GIVEAWAY! Send crypto to receive double back.",
    author: {
      id: "user-spammer",
      tag: "spammer#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-spammer>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async (payload) => sourceChannelMessages.push(payload),
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      timeout: async (value) => { timeoutValue = value; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };
  const moderationChannel = {
    isTextBased: () => true,
    isSendable: () => true,
    send: async (payload) => moderationChannelMessages.push(payload),
  };

  const handleMessage = createMessageHandler({
    client: { channels: { fetch: async () => moderationChannel } },
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => "moderation-channel",
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => false,
      getTimeoutMs: () => 15 * 60_000,
      getSpamProtection: () => ({ enabled: true }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 1);
  assert.equal(timeoutValue, 15 * 60_000);
  assert.equal(sourceChannelMessages.length, 0);
  assert.equal(moderationChannelMessages.length, 1);
});

test("does not moderate listed spam messages when spam protection is disabled", async () => {
  let deleted = 0;
  let timeoutCalls = 0;
  const message = {
    id: "spam-message-disabled",
    guildId: "guild-1",
    channelId: "channel-1",
    content: "FREE CRYPTO GIVEAWAY! Send crypto to receive double back.",
    author: {
      id: "user-spammer",
      tag: "spammer#0001",
      bot: false,
      displayAvatarURL: () => "https://example.com/avatar.png",
      toString: () => "<@user-spammer>",
    },
    channel: {
      isTextBased: () => true,
      isSendable: () => true,
      send: async () => {},
    },
    guild: { preferredLocale: "en-US", ownerId: "owner-1" },
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map(),
    member: {
      moderatable: true,
      permissions: { has: () => false },
      timeout: async () => { timeoutCalls += 1; },
    },
    delete: async () => { deleted += 1; },
    webhookId: null,
    inGuild: () => true,
  };

  const handleMessage = createMessageHandler({
    client: {},
    config: { timeoutMs: 60_000 },
    ocrService: { recognize: async () => "" },
    settingsStore: {
      getModerationChannelId: () => null,
      getParanoiaLevel: () => "high",
      getExcludedRoleIds: () => [],
      getExcludedAdministrators: () => true,
      getTimeoutMs: () => null,
      getSpamProtection: () => ({ enabled: false }),
    },
  });

  await handleMessage(message);

  assert.equal(deleted, 0);
  assert.equal(timeoutCalls, 0);
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

test("replies publicly and skips moderation for an easter egg hash match", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    const tempDirectory = await mkdtemp(join(tmpdir(), "easter-egg-handler-"));
    const referencePath = join(tempDirectory, "meme.png");
    await sharp(imageBuffer).toFile(referencePath);
    const manifestPath = join(tempDirectory, "manifest.json");
    await writeEasterEggPhotoManifest(tempDirectory, manifestPath);
    const references = await loadEasterEggPhotoManifest(manifestPath);
    const easterEggMatcher = await buildEasterEggMatcher(references, 0);

    let deleted = 0;
    let timeoutCalls = 0;
    const channelMessages = [];
    const replies = [];
    const message = {
      id: "message-easter-egg",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "user-egg",
        tag: "egg#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@user-egg>",
      },
      channel: {
        isTextBased: () => true,
        isSendable: () => true,
        send: async (payload) => {
          channelMessages.push(payload);
        },
      },
      reply: async (payload) => {
        replies.push(payload);
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
            name: "meme.png",
            contentType: "image/png",
            size: imageBuffer.length,
            url: imageUrl("meme"),
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
        timeout: async () => {
          timeoutCalls += 1;
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
        recognize: async () => "nothing useful",
      },
      settingsStore: {
        getModerationChannelId: () => null,
        getParanoiaLevel: () => "high",
        getExcludedRoleIds: () => [],
        getExcludedAdministrators: () => true,
        getTimeoutMs: () => null,
      },
      easterEggMatcher,
    });

    await handleMessage(message);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].content, "Jajaja, piqué.");
    assert.deepEqual(replies[0].allowedMentions, {
      repliedUser: false,
    });
    assert.equal(deleted, 0);
    assert.equal(timeoutCalls, 0);
    assert.equal(channelMessages.length, 0);
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

test("moderates the guild owner when administrator exclusion is disabled", async () => {
  const originalFetch = globalThis.fetch;
  const imageBuffer = await createHorizontalGradient(32, 32);
  globalThis.fetch = async () => createImageFetchResponse(imageBuffer);

  try {
    let deleted = 0;
    let timeoutValue = null;
    const channelMessages = [];
    const message = {
      id: "message-owner-enabled",
      guildId: "guild-1",
      channelId: "channel-1",
      author: {
        id: "owner-1",
        tag: "owner#0001",
        bot: false,
        displayAvatarURL: () => "https://example.com/avatar.png",
        toString: () => "<@owner-1>",
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

import test from "node:test";
import assert from "node:assert/strict";
import { createMessageHandler } from "../src/moderation.js";

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
        maxImageBytes: 10,
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

import test from "node:test";
import assert from "node:assert/strict";
import { handleSpamReportMessage } from "../src/spam-report.js";

function createCollection(messages) {
  const entries = messages.map((message) => [message.id, message]);
  const collection = new Map(entries);

  return {
    size: collection.size,
    values: () => collection.values(),
    last: () => [...collection.values()].at(-1),
    has: (id) => collection.has(id),
    filter: (predicate) => createCollection([...collection.values()].filter(predicate)),
  };
}

test("!spamreport deletes the reported message and its single-message thread", async () => {
  const events = [];
  const replies = [];
  const user = { id: "reported-user", tag: "reported-user#0001", bot: false };
  let timeoutCalls = 0;
  let targetMessage;

  const thread = {
    id: "thread-1",
    name: "spam thread",
    ownerId: user.id,
    isThread: () => true,
    isTextBased: () => true,
    isSendable: () => true,
    messages: {
      fetch: async (options) => {
        if (typeof options === "string") return targetMessage;
        return createCollection([targetMessage]);
      },
    },
    delete: async () => events.push("thread-delete"),
  };

  targetMessage = {
    id: "target-message",
    author: user,
    content: "same spam",
    channel: thread,
    channelId: thread.id,
    attachments: new Map(),
    embeds: [],
    delete: async () => events.push("message-delete"),
  };

  const reporter = {
    author: { id: "reporter", bot: false, tag: "reporter#0001" },
    content: "!spamreport",
    reference: { messageId: targetMessage.id },
    member: { permissions: { has: () => true } },
    guild: {
      members: {
        fetch: async () => ({ timeout: async () => { timeoutCalls += 1; } }),
      },
      channels: {
        cache: createCollection([thread]),
      },
    },
    channel: thread,
    client: {
      channels: {
        fetch: async () => null,
      },
    },
    inGuild: () => true,
    reply: async (payload) => replies.push(payload),
  };

  await handleSpamReportMessage(reporter);

  assert.deepEqual(events, ["message-delete", "thread-delete"]);
  assert.equal(timeoutCalls, 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /Usuario puesto en timeout/);
  assert.match(replies[0].content, /eliminados: 1/);
});

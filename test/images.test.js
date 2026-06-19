import test from "node:test";
import assert from "node:assert/strict";
import { getMessageImageSources } from "../src/images.js";

test("extracts image attachments", () => {
  const message = {
    attachments: new Map([
      [
        "attachment-1",
        {
          id: "attachment-1",
          name: "proof.png",
          contentType: "image/png",
          size: 1234,
          url: "https://cdn.example/proof.png",
        },
      ],
    ]),
    embeds: [],
  };

  assert.deepEqual(getMessageImageSources(message), [
    {
      url: "https://cdn.example/proof.png",
      label: "proof.png",
      size: 1234,
      forwarded: false,
    },
  ]);
});

test("extracts images and thumbnails from link embeds", () => {
  const message = {
    attachments: new Map(),
    embeds: [
      {
        url: "https://example.com/post",
        image: {
          url: "https://example.com/image.png",
          proxyURL: "https://media.discordapp.net/image.png",
        },
        thumbnail: {
          url: "https://example.com/thumb.png",
          proxyURL: "https://media.discordapp.net/thumb.png",
        },
      },
    ],
  };

  assert.deepEqual(getMessageImageSources(message), [
    {
      url: "https://media.discordapp.net/image.png",
      label: "https://example.com/post",
      size: null,
      forwarded: false,
    },
    {
      url: "https://media.discordapp.net/thumb.png",
      label: "https://example.com/post",
      size: null,
      forwarded: false,
    },
  ]);
});

test("deduplicates repeated image URLs", () => {
  const message = {
    attachments: new Map(),
    embeds: [
      {
        image: {
          url: "https://example.com/image.png",
        },
        thumbnail: {
          url: "https://example.com/image.png",
        },
      },
    ],
  };

  assert.equal(getMessageImageSources(message).length, 1);
});

test("extracts all images from forwarded message snapshots", () => {
  const forwardedMessage = {
    attachments: new Map([
      [
        "forwarded-1",
        {
          id: "forwarded-1",
          name: "first.png",
          contentType: "image/png",
          size: 100,
          url: "https://cdn.example/first.png",
        },
      ],
      [
        "forwarded-2",
        {
          id: "forwarded-2",
          name: "second.png",
          contentType: "image/png",
          size: 200,
          url: "https://cdn.example/second.png",
        },
      ],
    ]),
    embeds: [
      {
        image: {
          url: "https://example.com/forwarded-embed.png",
        },
      },
    ],
    messageSnapshots: new Map(),
  };
  const message = {
    attachments: new Map(),
    embeds: [],
    messageSnapshots: new Map([["snapshot-1", forwardedMessage]]),
  };

  assert.deepEqual(getMessageImageSources(message), [
    {
      url: "https://cdn.example/first.png",
      label: "Forwarded: first.png",
      size: 100,
      forwarded: true,
    },
    {
      url: "https://cdn.example/second.png",
      label: "Forwarded: second.png",
      size: 200,
      forwarded: true,
    },
    {
      url: "https://example.com/forwarded-embed.png",
      label: "Forwarded: https://example.com/forwarded-embed.png",
      size: null,
      forwarded: true,
    },
  ]);
});

test("extracts every image from a multi-image message", () => {
  const message = {
    attachments: new Map([
      [
        "image-1",
        {
          id: "image-1",
          name: "safe.png",
          contentType: "image/png",
          size: 100,
          url: "https://cdn.example/safe.png",
        },
      ],
      [
        "image-2",
        {
          id: "image-2",
          name: "matching.png",
          contentType: "image/png",
          size: 200,
          url: "https://cdn.example/matching.png",
        },
      ],
      [
        "image-3",
        {
          id: "image-3",
          name: "other.png",
          contentType: "image/png",
          size: 300,
          url: "https://cdn.example/other.png",
        },
      ],
    ]),
    embeds: [],
    messageSnapshots: new Map(),
  };

  assert.deepEqual(
    getMessageImageSources(message).map((source) => source.url),
    [
      "https://cdn.example/safe.png",
      "https://cdn.example/matching.png",
      "https://cdn.example/other.png",
    ],
  );
});

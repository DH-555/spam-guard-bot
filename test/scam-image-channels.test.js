import test from "node:test";
import assert from "node:assert/strict";
import {
  findKnownScamImageChannel,
  getDiscordAttachmentChannelId,
  SCAM_IMAGE_CHANNELS,
} from "../src/scam-image-channels.js";

test("extracts a Discord attachment source channel", () => {
  const url =
    "https://media.discordapp.net/attachments/740463504602955806/1540534318554677288/image.jpg?format=webp";

  assert.equal(getDiscordAttachmentChannelId(url), "740463504602955806");
  assert.equal(findKnownScamImageChannel(url)?.channelId, "740463504602955806");
});

test("does not flag an unknown or non-attachment URL", () => {
  assert.equal(
    findKnownScamImageChannel(
      "https://media.discordapp.net/attachments/123456789012345678/1540534318554677288/image.jpg",
    ),
    null,
  );
  assert.equal(
    findKnownScamImageChannel("https://example.com/attachments/740463504602955806/image.jpg"),
    null,
  );
});

test("keeps the known-channel list editable through the JSON-backed export", () => {
  assert.ok(SCAM_IMAGE_CHANNELS.some((channel) => channel.channelId === "740463504602955806"));
});

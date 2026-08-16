import test from "node:test";
import assert from "node:assert/strict";
import {
  createInviteResolver,
  extractDiscordInviteCodes,
  findMaliciousInvite,
} from "../src/invite-protection.js";
import { MALICIOUS_GUILD_IDS } from "../src/malicious-servers.js";
import {
  findNsfwInvite,
  findNsfwServerKeyword,
  NSFW_SERVER_KEYWORDS,
} from "../src/nsfw-servers.js";

test("loads the global malicious server list from JSON", () => {
  assert.ok(Array.isArray(MALICIOUS_GUILD_IDS));
  assert.ok(MALICIOUS_GUILD_IDS.every((guildId) => /^\d{17,20}$/u.test(guildId)));
});

test("extracts Discord invite codes from supported link formats", () => {
  assert.deepEqual(
    extractDiscordInviteCodes(
      "https://discord.gg/alpha discord.com/invite/beta https://discordapp.com/invite/alpha",
    ),
    ["alpha", "beta"],
  );
});

test("extracts obfuscated and URL-encoded invite codes", () => {
  assert.deepEqual(
    extractDiscordInviteCodes(
      "CREATE_A_TICKET (discord:/#@discord.gg/Vv6a4My6he)",
    ),
    ["Vv6a4My6he"],
  );

  assert.deepEqual(
    extractDiscordInviteCodes(
      [
        "(<ht",
        "> tp",
        "s:////\\@di",
        "sco",
        "rd.",
        "gg/%56%76%36%61%34%4D%79%36%68%65>)",
      ].join("\n"),
    ),
    ["Vv6a4My6he"],
  );
});

test("extracts invites wrapped in mailto, Markdown, brackets, and Unicode text", () => {
  const messages = [
    "**mailto:/%7CŽdiscord.gg/Vv6a4My6he**",
    "(**discord:/#@discord.gg/Vv6a4My6he**)",
    "**mailto:/#@discord.gg/Vv6a4My6he**",
    "[   **mailto:/#@discord.gg/Vv6a4My6he**  ]",
  ];

  for (const message of messages) {
    assert.deepEqual(extractDiscordInviteCodes(message), ["Vv6a4My6he"]);
  }
});

test("finds a malicious invite by resolving its guild ID", async () => {
  const resolver = async (code) =>
    code === "malicious"
      ? { guildId: "123456789012345678", guildName: "Safe server" }
      : { guildId: "987654321098765432", guildName: "Other server" };

  assert.deepEqual(
    await findMaliciousInvite(
      "Join us: https://discord.gg/malicious",
      ["123456789012345678"],
      resolver,
    ),
    {
      code: "malicious",
      guildId: "123456789012345678",
      guildName: "Safe server",
    },
  );
});

test("detects NSFW keywords in an invite destination server name", async () => {
  assert.equal(findNsfwServerKeyword("🔞 SquirT +18", NSFW_SERVER_KEYWORDS), "+18");

  const invite = await findNsfwInvite(
    "https://discord.gg/nsfw-server",
    async () => ({
      guildId: "123456789012345678",
      guildName: "Official +18 Squirt Lounge",
    }),
    ["+18", "squirt"],
  );

  assert.deepEqual(invite, {
    code: "nsfw-server",
    guildId: "123456789012345678",
    guildName: "Official +18 Squirt Lounge",
    keyword: "+18",
  });
});

test("detects NSFW keywords in the invite destination description, tags, and emoji", async () => {
  const invite = await findNsfwInvite(
    "https://discord.gg/roblox-external",
    async () => ({
      guildId: "123456789012345678",
      guildName: "BEST ROBLOX EXTERNAL!",
      guildDescription: "FREE cheats, cracks, leaks, AI Jailbreaks AND NSFW content including 3000+ NSFW GIFs & Memes!",
      guildTags: ["NSFW"],
      guildTagEmoji: "+18",
    }),
    NSFW_SERVER_KEYWORDS,
  );

  assert.equal(invite.code, "roblox-external");
  assert.equal(invite.keyword, "nsfw");
});

test("caches invite lookups", async () => {
  let fetches = 0;
  const resolveInvite = createInviteResolver({
    fetchInvite: async () => {
      fetches += 1;
      return { guild: { id: "123456789012345678" } };
    },
  });

  assert.deepEqual(await resolveInvite("same-code"), {
    guildId: "123456789012345678",
    guildName: null,
  });
  assert.deepEqual(await resolveInvite("same-code"), {
    guildId: "123456789012345678",
    guildName: null,
  });
  assert.equal(fetches, 1);
});

test("keeps invite guild descriptions and tag metadata available to moderation", async () => {
  const resolveInvite = createInviteResolver({
    fetchInvite: async () => ({
      guild: {
        id: "123456789012345678",
        name: "BEST ROBLOX EXTERNAL!",
        description: "FREE cheats and NSFW content",
        features: ["GUILD_TAGS"],
        tag: "NSFW",
        tagEmoji: "+18",
      },
    }),
  });

  assert.deepEqual(await resolveInvite("roblox-external"), {
    guildId: "123456789012345678",
    guildName: "BEST ROBLOX EXTERNAL!",
    guildDescription: "FREE cheats and NSFW content",
    guildFeatures: ["GUILD_TAGS"],
    guildTag: "NSFW",
    guildTagEmoji: "+18",
  });
});

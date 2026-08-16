const DISCORD_INVITE_PATTERN =
  /(?<![a-z0-9_-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9_-]+)/giu;

const DEFAULT_INVITE_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_FAILED_INVITE_CACHE_TTL_MS = 60_000;

function decodeUrlEncoding(value) {
  let decoded = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);

      if (next === decoded) {
        break;
      }

      decoded = next;
    } catch {
      break;
    }
  }

  return decoded;
}

function compactObfuscatedText(value) {
  return value
    .replace(/&#(?:46|x2e);/giu, ".")
    .replace(/[\s\\<>*`\u200b-\u200d\ufeff]/gu, "")
    .replace(
      /(?<=[a-z0-9_-])(?=discord(?:app)?\.(?:com\/invite|gg\/))/giu,
      "\n",
    )
    .replace(/(?<=[a-z0-9_-])(?=https?:\/\/)/giu, "\n");
}

function getInviteTextVariants(content) {
  const decoded = decodeUrlEncoding(content);
  const compact = compactObfuscatedText(content);
  const compactDecoded = compactObfuscatedText(decoded);

  return [...new Set([content, decoded, compact, compactDecoded])];
}

export function extractDiscordInviteCodes(content) {
  if (typeof content !== "string" || content.length === 0) {
    return [];
  }

  const codes = new Set();

  for (const variant of getInviteTextVariants(content)) {
    for (const match of variant.matchAll(DISCORD_INVITE_PATTERN)) {
      const code = match[1]?.trim();

      if (code) {
        codes.add(code);
      }
    }
  }

  return [...codes];
}

export function isDiscordGuildId(value) {
  return typeof value === "string" && /^\d{17,20}$/u.test(value);
}

export function normalizeBlockedGuildIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((guildId) => isDiscordGuildId(guildId))
        .map((guildId) => guildId.trim()),
    ),
  ];
}

export function createInviteResolver(
  client,
  {
    cacheTtlMs = DEFAULT_INVITE_CACHE_TTL_MS,
    failedCacheTtlMs = DEFAULT_FAILED_INVITE_CACHE_TTL_MS,
  } = {},
) {
  const cache = new Map();

  return async function resolveInvite(code) {
    const now = Date.now();
    const cached = cache.get(code);

    if (cached && cached.expiresAt > now) {
      return cached.invite;
    }

    try {
      const invite = await client.fetchInvite(code);
      const guildId = invite?.guild?.id ?? invite?.guildId ?? null;

      const guild = invite?.guild;
      const resolvedInvite = guildId
        ? {
            guildId,
            guildName: guild?.name ?? invite?.guildName ?? null,
            ...(typeof guild?.description === "string"
              ? { guildDescription: guild.description }
              : {}),
            ...(Array.isArray(guild?.features)
              ? { guildFeatures: guild.features }
              : {}),
            ...(Array.isArray(guild?.tags)
              ? { guildTags: guild.tags }
              : {}),
            ...(typeof (guild?.tag ?? guild?.serverTag) === "string"
              ? { guildTag: guild.tag ?? guild.serverTag }
              : {}),
            ...(typeof (guild?.tagEmoji ?? guild?.serverTagEmoji ?? guild?.unicodeEmoji) === "string"
              ? { guildTagEmoji: guild.tagEmoji ?? guild.serverTagEmoji ?? guild.unicodeEmoji }
              : {}),
            ...(guild?.welcomeScreen
              ? { guildWelcomeScreen: guild.welcomeScreen }
              : {}),
          }
        : null;

      cache.set(code, {
        invite: resolvedInvite,
        expiresAt: now + cacheTtlMs,
      });

      return resolvedInvite;
    } catch (error) {
      cache.set(code, {
        invite: null,
        expiresAt: now + failedCacheTtlMs,
      });
      return null;
    }
  };
}

export async function findMaliciousInvite(
  content,
  blockedGuildIds,
  resolveInvite,
) {
  const blockedIds = new Set(normalizeBlockedGuildIds(blockedGuildIds));

  if (blockedIds.size === 0) {
    return null;
  }

  for (const code of extractDiscordInviteCodes(content)) {
    const invite = await resolveInvite(code);
    const guildId = invite?.guildId;

    if (guildId && blockedIds.has(guildId)) {
      return { code, ...invite };
    }
  }

  return null;
}

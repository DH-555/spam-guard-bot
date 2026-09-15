const DISCORD_INVITE_PATTERN =
  /(?<![a-z0-9_-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9_-]{1,64})(?![a-z0-9_-])/giu;

const DEFAULT_INVITE_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_FAILED_INVITE_CACHE_TTL_MS = 60_000;
const MAX_INVITE_CODE_LENGTH = 64;
const MAX_INVITES_PER_TEXT = 16;
const MAX_INVITE_CACHE_ENTRIES = 2_048;

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

      if (codes.size >= MAX_INVITES_PER_TEXT) {
        return [...codes];
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
  const pending = new Map();

  function setCache(key, invite, expiresAt) {
    const now = Date.now();
    for (const [cachedKey, cachedValue] of cache) {
      if (cachedValue.expiresAt <= now) {
        cache.delete(cachedKey);
      }
    }

    cache.delete(key);
    cache.set(key, { invite, expiresAt });

    while (cache.size > MAX_INVITE_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }

  return async function resolveInvite(code) {
    if (
      typeof code !== "string" ||
      !new RegExp(`^[a-z0-9_-]{1,${MAX_INVITE_CODE_LENGTH}}$`, "iu").test(code.trim())
    ) {
      return null;
    }

    const normalizedCode = code.trim();
    const cacheKey = normalizedCode.toLowerCase();
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached.invite;
    }

    if (cached) {
      cache.delete(cacheKey);
    }

    const pendingRequest = pending.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    // OCR commonly preserves an all-caps rendering of a link. Retry the
    // lower-case code when the first lookup fails, which avoids missing a
    // lower-case vanity invite such as DISCORD.GG/PIPER.
    const candidateCodes = [...new Set([
      normalizedCode,
      normalizedCode.toLowerCase(),
    ])];

    const request = (async () => {
      for (const candidateCode of candidateCodes) {
        try {
          const invite = await client.fetchInvite(candidateCode);
          const guildId = invite?.guild?.id ?? invite?.guildId ?? null;

          const guild = invite?.guild;
          const guildDescription =
            guild?.description ??
            guild?.welcomeScreen?.description ??
            invite?.guildDescription ??
            invite?.description ??
            null;
          const resolvedInvite = guildId
            ? {
                guildId,
                guildName: guild?.name ?? invite?.guildName ?? null,
                ...(typeof guildDescription === "string"
                  ? { guildDescription }
                  : {}),
                ...(Array.isArray(guild?.features)
                  ? { guildFeatures: guild.features }
                  : {}),
                ...(typeof guild?.nsfwLevel === "number"
                  ? { guildNsfwLevel: guild.nsfwLevel }
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

          setCache(cacheKey, resolvedInvite, now + cacheTtlMs);

          return resolvedInvite;
        } catch {
          // Try the next spelling before marking the invite as unavailable.
        }
      }

      setCache(cacheKey, null, now + failedCacheTtlMs);
      return null;
    })();

    pending.set(cacheKey, request);
    try {
      return await request;
    } finally {
      pending.delete(cacheKey);
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

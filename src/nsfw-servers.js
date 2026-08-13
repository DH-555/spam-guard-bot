import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractDiscordInviteCodes } from "./invite-protection.js";

const nsfwKeywordsPath = fileURLToPath(
  new URL("../nsfw-server-keywords.json", import.meta.url),
);

const nsfwKeywords = JSON.parse(readFileSync(nsfwKeywordsPath, "utf8"));

export function normalizeNsfwServerText(value) {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase()
        .replace(/\s+/gu, " ")
        .trim()
    : "";
}

export function normalizeNsfwKeywords(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((keyword) => typeof keyword === "string")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    ),
  ];
}

export function findNsfwServerKeyword(serverName, keywords = nsfwKeywords) {
  const normalizedName = normalizeNsfwServerText(serverName);

  if (!normalizedName) {
    return null;
  }

  for (const keyword of normalizeNsfwKeywords(keywords)) {
    const normalizedKeyword = normalizeNsfwServerText(keyword);

    if (normalizedKeyword && normalizedName.includes(normalizedKeyword)) {
      return keyword;
    }
  }

  return null;
}

export async function findNsfwInvite(
  content,
  resolveInvite,
  keywords = nsfwKeywords,
) {
  for (const code of extractDiscordInviteCodes(content)) {
    const invite = await resolveInvite(code);
    const keyword = findNsfwServerKeyword(invite?.guildName, keywords);

    if (keyword) {
      return { code, ...invite, keyword };
    }
  }

  return null;
}

export const NSFW_SERVER_KEYWORDS = Object.freeze(
  normalizeNsfwKeywords(nsfwKeywords),
);

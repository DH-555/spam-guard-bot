import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const blockedDomainsPath = fileURLToPath(
  new URL("../blocked-domains.json", import.meta.url),
);

const blockedDomains = JSON.parse(readFileSync(blockedDomainsPath, "utf8"));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDomain(domain) {
  return typeof domain === "string"
    ? domain.trim().toLowerCase().replace(/^\.+|\.+$/gu, "")
    : "";
}

const configuredDomains = Array.isArray(blockedDomains)
  ? blockedDomains
  : blockedDomains.domains;

export const BLOCKED_DOMAINS = Object.freeze(
  [...new Set((configuredDomains ?? []).map(normalizeDomain).filter(Boolean))],
);

const BLOCKED_DOMAIN_PATTERNS = BLOCKED_DOMAINS.map((domain) => new RegExp(
  `(?<![a-z0-9.-])https?:\\/\\/(?:[a-z0-9-]+\\.)*${escapeRegex(domain)}(?::\\d+)?(?:[/?#][^\\s<>]*)?(?![a-z0-9.-])`,
  "iu",
));

const BLOCKED_DOMAIN_OCR_PATTERNS = BLOCKED_DOMAINS.map((domain) => ({
  domain,
  pattern: new RegExp(
    `(?<![a-z0-9.-])(?:https?:\\/\\/)?(?:[a-z0-9-]+\\s*\\.\\s*)*${escapeRegex(domain)}(?=$|[^a-z0-9.-]|\\.(?![a-z0-9-]))`,
    "iu",
  ),
}));

const BLOCKED_LINK_PATTERNS = Object.freeze([
  /(?<![a-z0-9.-])https?:\/\/surveybuilder\.io\/c\/capture\/mhnkqthus3a(?:[/?#][^\s<>]*)?(?![a-z0-9.-])/iu,
  /(?<![a-z0-9.-])https?:\/\/(?:www\.)?upwork\.com\/freelancers\/~011c10fca307bf0e02(?:[/?#][^\s<>]*)?(?![a-z0-9.-])/iu,
  /(?<![a-z0-9.-])https?:\/\/(?:www\.)?agentrouter\.org\/register\?aff=qaiK(?:[&#][^\s<>]*)?(?![a-z0-9.-])/iu,
  /(?<![a-z0-9.-])https?:\/\/t\.me\/(?:SJDIJOG|SDITRIVDK|SFIOSGK)(?:[/?#][^\s<>]*)?(?![a-z0-9.-])/iu,
  ...BLOCKED_DOMAIN_PATTERNS,
]);

export function findBlockedLink(text) {
  if (typeof text !== "string" || !text) {
    return null;
  }

  for (const pattern of BLOCKED_LINK_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return findBlockedDomain(text);
}

export function findBlockedDomain(text) {
  if (typeof text !== "string" || !text) {
    return null;
  }

  const searchableText = text.replace(/\s*\.\s*/gu, ".");

  for (const { domain, pattern } of BLOCKED_DOMAIN_OCR_PATTERNS) {
    if (pattern.test(searchableText)) {
      return domain;
    }
  }

  return null;
}

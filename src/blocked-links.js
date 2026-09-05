import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const blockedDomainsPath = fileURLToPath(
  new URL("../blocked-domains.json", import.meta.url),
);

const blockedDomains = JSON.parse(readFileSync(blockedDomainsPath, "utf8"));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCKED_DOMAIN_PATTERNS = blockedDomains.map((domain) => new RegExp(
  `(?<![a-z0-9.-])https?:\\/\\/(?:[a-z0-9-]+\\.)*${escapeRegex(domain)}(?::\\d+)?(?:[/?#][^\\s<>]*)?(?![a-z0-9.-])`,
  "iu",
));

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

  return null;
}

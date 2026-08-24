const BLOCKED_LINK_PATTERNS = Object.freeze([
  /(?<![a-z0-9.-])https?:\/\/surveybuilder\.io\/c\/capture\/mhnkqthus3a(?:[/?#][^\s<>]*)?(?![a-z0-9.-])/iu,
]);

export function findBlockedLink(text) {
  if (typeof text !== "string" || !text) {
    return null;
  }

  return BLOCKED_LINK_PATTERNS.find((pattern) => pattern.test(text))?.source ?? null;
}

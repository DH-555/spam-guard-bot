import spamMessages from "../spam-messages.json" with { type: "json" };

// Matching is case-insensitive and ignores accents and repeated whitespace.
export const SPAM_MESSAGES = Object.freeze(spamMessages);

export function normalizeSpamText(value) {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/\s+/gu, " ").trim().toLowerCase()
    : "";
}

export function findSpamMessage(content, spamMessages = SPAM_MESSAGES) {
  const normalizedContent = normalizeSpamText(content);

  if (!normalizedContent) {
    return null;
  }

  for (const spamMessage of spamMessages) {
    const normalizedSpamMessage = normalizeSpamText(spamMessage);

    if (normalizedSpamMessage && normalizedContent.includes(normalizedSpamMessage)) {
      return spamMessage;
    }
  }

  return null;
}

const WITHDRAWAL_KEYWORDS = ["WITHDRAWAL"];
const SUCCESS_KEYWORDS = ["SUCCESS", "SUCCEEDED", "SUCCESSFUL", "SUCCESSFULLY"];
const USDT_KEYWORDS = ["USDT"];
export const PARANOIA_LEVELS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

export function normalizeParanoiaLevel(level) {
  if (typeof level !== "string") {
    return PARANOIA_LEVELS.HIGH;
  }

  const normalized = level.trim().toLowerCase();

  if (normalized === PARANOIA_LEVELS.LOW) {
    return PARANOIA_LEVELS.LOW;
  }

  if (normalized === PARANOIA_LEVELS.MEDIUM) {
    return PARANOIA_LEVELS.MEDIUM;
  }

  if (normalized === PARANOIA_LEVELS.HIGH) {
    return PARANOIA_LEVELS.HIGH;
  }

  return PARANOIA_LEVELS.HIGH;
}

function containsWholeWord(text, word) {
  return new RegExp(`\\b${word}\\b`, "u").test(text);
}

export function normalizeOcrText(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

export function containsScamPhrase(text, paranoiaLevel = PARANOIA_LEVELS.HIGH) {
  const normalizedLevel = normalizeParanoiaLevel(paranoiaLevel);

  if (normalizedLevel === PARANOIA_LEVELS.LOW) {
    return false;
  }

  const rawText = text;
  const normalizedText = normalizeOcrText(text);

  const hasWithdrawalKeyword = WITHDRAWAL_KEYWORDS.some((word) =>
    containsWholeWord(normalizedText, word),
  );
  const hasSuccessKeyword = SUCCESS_KEYWORDS.some((word) =>
    containsWholeWord(normalizedText, word),
  );
  const hasUsdtKeyword = USDT_KEYWORDS.some((word) =>
    containsWholeWord(rawText, word),
  );

  if (normalizedLevel === PARANOIA_LEVELS.MEDIUM) {
    return hasWithdrawalKeyword && hasSuccessKeyword && hasUsdtKeyword;
  }

  return hasWithdrawalKeyword && (hasSuccessKeyword || hasUsdtKeyword);
}

export function truncateText(text, maxLength = 900) {
  const compactText = text.replace(/\s+/gu, " ").trim();

  if (compactText.length <= maxLength) {
    return compactText;
  }

  return `${compactText.slice(0, maxLength - 1)}…`;
}

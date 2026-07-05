const WITHDRAWAL_KEYWORDS = ["WITHDRAWAL"];
const SUCCESS_KEYWORDS = ["SUCCESS", "SUCCEEDED", "SUCCESSFUL", "SUCCESSFULLY"];
const USDT_KEYWORDS = ["USDT"];
const AMOUNT_KEYWORDS = ["AMOUNT"];
const COMPLETED_KEYWORDS = ["COMPLETED"];
const TRANSFER_KEYWORDS = ["TRANSFER"];
const EXTREME_KEYWORDS = [
  "WITHDRAWAL",
  "AMOUNT",
  "COMPLETED",
  "TRANSFER",
  "SUCCS",
  "TRX",
  "MONEY",
  "MR BEAST",
  "CRYPTOCURRENCY",
  "CASINO",
  "GIVEAWAY",
  "GIVING AWAY",
  "BETS",
  "BONUS",
  "BONUSES",
];
export const PARANOIA_LEVELS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  EXTREME: "extreme",
});

export const DEFAULT_PARANOIA_LEVEL = PARANOIA_LEVELS.HIGH;

export function normalizeParanoiaLevel(level) {
  if (typeof level !== "string") {
    return DEFAULT_PARANOIA_LEVEL;
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

  if (normalized === PARANOIA_LEVELS.EXTREME) {
    return PARANOIA_LEVELS.EXTREME;
  }

  return DEFAULT_PARANOIA_LEVEL;
}

function containsWholeWord(text, word) {
  return new RegExp(`\\b${word}\\b`, "u").test(text);
}

function containsPhrase(text, phrase) {
  return text.includes(phrase);
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((word) => containsWholeWord(text, word));
}

function hasAnyPhrase(text, phrases) {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

export function normalizeOcrText(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

export function containsScamPhrase(text, paranoiaLevel = DEFAULT_PARANOIA_LEVEL) {
  const normalizedLevel = normalizeParanoiaLevel(paranoiaLevel);

  if (normalizedLevel === PARANOIA_LEVELS.LOW) {
    return false;
  }

  const rawText = text;
  const normalizedText = normalizeOcrText(text);

  const hasWithdrawalKeyword = hasAnyKeyword(normalizedText, WITHDRAWAL_KEYWORDS);
  const hasSuccessKeyword = hasAnyKeyword(normalizedText, SUCCESS_KEYWORDS);
  const hasUsdtKeyword = hasAnyKeyword(rawText, USDT_KEYWORDS);
  const hasAmountKeyword = hasAnyKeyword(normalizedText, AMOUNT_KEYWORDS);
  const hasCompletedKeyword = hasAnyKeyword(normalizedText, COMPLETED_KEYWORDS);
  const hasTransferKeyword = hasAnyKeyword(normalizedText, TRANSFER_KEYWORDS);
  const hasExtremeKeyword = hasAnyKeyword(normalizedText, EXTREME_KEYWORDS) ||
    hasAnyPhrase(normalizedText, EXTREME_KEYWORDS);

  if (normalizedLevel === PARANOIA_LEVELS.MEDIUM) {
    return hasWithdrawalKeyword && hasSuccessKeyword && hasUsdtKeyword;
  }

  if (normalizedLevel === PARANOIA_LEVELS.EXTREME) {
    return hasExtremeKeyword;
  }

  return (
    hasWithdrawalKeyword &&
    (hasSuccessKeyword ||
      hasUsdtKeyword ||
      (hasAmountKeyword && hasCompletedKeyword && hasTransferKeyword))
  );
}

export function truncateText(text, maxLength = 900) {
  const compactText = text.replace(/\s+/gu, " ").trim();

  if (compactText.length <= maxLength) {
    return compactText;
  }

  return `${compactText.slice(0, maxLength - 1)}…`;
}

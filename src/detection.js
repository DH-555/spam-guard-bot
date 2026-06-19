const WITHDRAWAL_KEYWORDS = ["WITHDRAWAL"];
const SUCCESS_KEYWORDS = ["SUCCESS", "SUCCEEDED", "SUCCESSFUL"];

function containsWholeWord(text, word) {
  return new RegExp(`\\b${word}\\b`, "u").test(text);
}

export function normalizeOcrText(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

export function containsScamPhrase(text) {
  const normalizedText = normalizeOcrText(text);

  const hasWithdrawalKeyword = WITHDRAWAL_KEYWORDS.some((word) =>
    containsWholeWord(normalizedText, word),
  );
  const hasSuccessKeyword = SUCCESS_KEYWORDS.some((word) =>
    containsWholeWord(normalizedText, word),
  );

  return hasWithdrawalKeyword && hasSuccessKeyword;
}

export function truncateText(text, maxLength = 900) {
  const compactText = text.replace(/\s+/gu, " ").trim();

  if (compactText.length <= maxLength) {
    return compactText;
  }

  return `${compactText.slice(0, maxLength - 1)}…`;
}

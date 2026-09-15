const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/gu;
const MARKDOWN_CHARACTERS = new Set(["\\", "`", "*", "_", "~", "|", "<", ">", "#", "[", "]", "(", ")"]);
const MAX_SANITIZE_INPUT = 16_000;

function removeControlCharacters(value) {
  return value.normalize("NFKC").replace(CONTROL_CHARACTERS, "");
}

export function sanitizeText(value, maxLength = 4_000) {
  if (typeof value !== "string") {
    return "";
  }

  return removeControlCharacters(value).slice(0, Math.min(maxLength, MAX_SANITIZE_INPUT));
}

export function escapeDiscordMarkdown(value, maxLength = 900) {
  const sanitized = sanitizeText(value, MAX_SANITIZE_INPUT);
  let result = "";

  for (const character of sanitized) {
    const escaped = MARKDOWN_CHARACTERS.has(character)
      ? `\\${character}`
      : character;

    if (result.length + escaped.length > maxLength) {
      break;
    }

    result += escaped;
  }

  return result;
}

export function sanitizeLogText(value, maxLength = 256) {
  return sanitizeText(value, maxLength)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

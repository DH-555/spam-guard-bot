import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const spamMessagesPath = fileURLToPath(new URL("../spam-messages.json", import.meta.url));

// JSON does not officially allow literal line breaks inside strings. We accept
// them here so messages can be pasted into the file without escaping anything.
function escapeLiteralControlCharactersInStrings(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const character of source) {
    if (inString) {
      if (escaped) {
        result += character;
        escaped = false;
      } else if (character === "\\") {
        result += character;
        escaped = true;
      } else if (character === '"') {
        result += character;
        inString = false;
      } else if (character === "\n") {
        result += "\\n";
      } else if (character === "\r") {
        result += "\\r";
      } else if (character === "\t") {
        result += "\\t";
      } else {
        result += character;
      }
    } else {
      result += character;
      if (character === '"') {
        inString = true;
      }
    }
  }

  return result;
}

const spamMessages = JSON.parse(
  escapeLiteralControlCharactersInStrings(readFileSync(spamMessagesPath, "utf8")),
);

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

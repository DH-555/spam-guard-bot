/** Normalize common link obfuscations before URL and domain matching. */
export function normalizeObfuscatedLinkText(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .normalize("NFKC")
    .replace(/\[\s*\.\s*\]/gu, ".")
    .replace(/\b(https?)\\?:\\?\/\\?\//giu, "$1://");
}

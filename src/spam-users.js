import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const spamUsersPath = fileURLToPath(new URL("../spam-users.json", import.meta.url));

let configuredSpamUsers = [];
try {
  const parsed = JSON.parse(readFileSync(spamUsersPath, "utf8"));
  configuredSpamUsers = Array.isArray(parsed) ? parsed : parsed.userIds;
} catch (error) {
  console.warn("[Spam users] Could not load spam-users.json:", error);
}

const SPAM_USER_IDS = new Set(
  (configuredSpamUsers ?? []).filter((id) => typeof id === "string" && /^\d{17,20}$/.test(id)),
);

export function isKnownSpamUser(userId) {
  return SPAM_USER_IDS.has(userId);
}

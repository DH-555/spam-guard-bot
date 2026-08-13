import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeBlockedGuildIds } from "./invite-protection.js";

const maliciousServersPath = fileURLToPath(
  new URL("../malicious-servers.json", import.meta.url),
);

const maliciousServers = JSON.parse(
  readFileSync(maliciousServersPath, "utf8"),
);

export const MALICIOUS_GUILD_IDS = Object.freeze(
  normalizeBlockedGuildIds(maliciousServers),
);

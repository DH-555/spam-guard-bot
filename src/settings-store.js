import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeParanoiaLevel } from "./detection.js";
import { normalizeRaidLevel } from "./raid-protection.js";

function normalizeRoleIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((roleId) => typeof roleId === "string" && roleId.trim()))];
}

function normalizeExcludedAdministrators(value) {
  return typeof value === "boolean" ? value : true;
}

export class SettingsStore {
  #filePath;
  #settings = {};
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.#filePath = filePath;
  }

  async load() {
    try {
      const contents = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(contents);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The settings file must contain a JSON object.");
      }

      this.#settings = parsed;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.#settings = {};
        return;
      }

      throw error;
    }
  }

  getModerationChannelId(guildId) {
    const channelId = this.#settings[guildId]?.moderationChannelId;
    return typeof channelId === "string" ? channelId : null;
  }

  getParanoiaLevel(guildId) {
    return normalizeParanoiaLevel(this.#settings[guildId]?.paranoiaLevel);
  }

  getExcludedRoleIds(guildId) {
    return normalizeRoleIds(this.#settings[guildId]?.excludedRoleIds);
  }

  getExcludedAdministrators(guildId) {
    return normalizeExcludedAdministrators(
      this.#settings[guildId]?.excludedAdministrators,
    );
  }

  getTimeoutMs(guildId) {
    const timeoutMs = this.#settings[guildId]?.timeoutMs;
    return Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
  }

  getRaidProtection(guildId) {
    const settings = this.#settings[guildId];
    return {
      enabled: settings?.raidProtection?.enabled !== false,
      level: normalizeRaidLevel(settings?.raidProtection?.level),
    };
  }

  async setRaidProtection(guildId, enabled, level) {
    this.#settings[guildId] = { ...this.#settings[guildId], raidProtection: {
      enabled: Boolean(enabled), level: normalizeRaidLevel(level),
    }};
    await this.#save();
  }

  async setModerationChannelId(guildId, channelId) {
    this.#settings[guildId] = {
      ...this.#settings[guildId],
      moderationChannelId: channelId,
    };

    await this.#save();
  }

  async setParanoiaLevel(guildId, level) {
    this.#settings[guildId] = {
      ...this.#settings[guildId],
      paranoiaLevel: normalizeParanoiaLevel(level),
    };

    await this.#save();
  }

  async addExcludedRoleId(guildId, roleId) {
    const excludedRoleIds = new Set(this.getExcludedRoleIds(guildId));
    excludedRoleIds.add(roleId);

    this.#settings[guildId] = {
      ...this.#settings[guildId],
      excludedRoleIds: [...excludedRoleIds],
    };

    await this.#save();
  }

  async setExcludedAdministrators(guildId, excludedAdministrators) {
    this.#settings[guildId] = {
      ...this.#settings[guildId],
      excludedAdministrators: normalizeExcludedAdministrators(excludedAdministrators),
    };

    await this.#save();
  }

  async removeExcludedRoleId(guildId, roleId) {
    const excludedRoleIds = new Set(this.getExcludedRoleIds(guildId));
    excludedRoleIds.delete(roleId);

    this.#settings[guildId] = {
      ...this.#settings[guildId],
      excludedRoleIds: [...excludedRoleIds],
    };

    await this.#save();
  }

  async setTimeoutMs(guildId, timeoutMs) {
    this.#settings[guildId] = {
      ...this.#settings[guildId],
      timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
    };

    await this.#save();
  }

  #save() {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const directory = dirname(this.#filePath);
      const temporaryPath = `${this.#filePath}.tmp`;

      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(this.#settings, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.#filePath);
    });

    return this.#writeQueue;
  }
}

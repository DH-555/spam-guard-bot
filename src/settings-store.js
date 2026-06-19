import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

  async setModerationChannelId(guildId, channelId) {
    this.#settings[guildId] = {
      ...this.#settings[guildId],
      moderationChannelId: channelId,
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

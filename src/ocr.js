import { mkdir } from "node:fs/promises";
import { createWorker } from "tesseract.js";

export class OcrService {
  #cachePath;
  #workerPromise;
  #queue = Promise.resolve();

  constructor(cachePath) {
    this.#cachePath = cachePath;
  }

  async recognize(image) {
    const task = this.#queue.then(async () => {
      const worker = await this.#getWorker();
      const result = await worker.recognize(image);
      return result.data.text;
    });

    this.#queue = task.catch(() => undefined);
    return task;
  }

  async terminate() {
    await this.#queue;

    if (this.#workerPromise) {
      const worker = await this.#workerPromise;
      await worker.terminate();
    }
  }

  #getWorker() {
    this.#workerPromise ??= mkdir(this.#cachePath, { recursive: true }).then(() =>
      createWorker("eng", undefined, {
        cachePath: this.#cachePath,
      }),
    );
    return this.#workerPromise;
  }
}

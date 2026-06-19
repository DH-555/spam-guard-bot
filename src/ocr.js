import { createWorker } from "tesseract.js";

export class OcrService {
  #workerPromise;
  #queue = Promise.resolve();

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
    this.#workerPromise ??= createWorker("eng");
    return this.#workerPromise;
  }
}

import { Worker } from "node:worker_threads";
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerTask,
  WorkerTaskMap,
} from "./worker-protocol.js";

interface Request {
  request: WorkerRequest;
  resolve: (value: string | import("../shared/contracts.js").Track) => void;
  reject: (error: Error) => void;
}
export class Workers {
  private queue: Request[] = [];
  private slots: { worker: Worker; current?: Request }[] = [];
  private id = 0;
  private closed = false;
  constructor(count = 2) {
    for (let i = 0; i < count; i++) this.spawn();
  }
  private spawn() {
    const slot: { worker: Worker; current?: Request } = {
      worker: new Worker(new URL("./worker.js", import.meta.url)),
    };
    slot.worker.on("message", (response: WorkerResponse) => {
      if ("error" in response) slot.current?.reject(new Error(response.error));
      else slot.current?.resolve(response.result);
      slot.current = undefined;
      this.pump();
    });
    slot.worker.on("error", (error) => {
      slot.current?.reject(error);
      slot.current = undefined;
    });
    slot.worker.on("exit", () => {
      slot.current?.reject(new Error("Рабочий процесс завершился"));
      this.slots = this.slots.filter((s) => s !== slot);
      if (!this.closed) {
        this.spawn();
        this.pump();
      }
    });
    this.slots.push(slot);
  }
  run<Task extends WorkerTask>(
    task: Task,
    args: WorkerTaskMap[Task]["args"],
  ): Promise<WorkerTaskMap[Task]["result"]> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("Сервис остановлен"));
      const request = { id: ++this.id, task, args } as WorkerRequest;
      this.queue.push({
        request,
        resolve: (value) => resolve(value as WorkerTaskMap[Task]["result"]),
        reject,
      });
      this.pump();
    });
  }
  private pump() {
    for (const slot of this.slots)
      if (!slot.current && this.queue.length) {
        slot.current = this.queue.shift()!;
        slot.worker.postMessage(slot.current.request);
      }
  }
  async close() {
    this.closed = true;
    for (const task of this.queue.splice(0))
      task.reject(new Error("Сервис остановлен"));
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
  }
}

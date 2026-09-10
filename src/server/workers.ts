import { Worker } from 'node:worker_threads';

interface Request { id: number; task: string; args: unknown; resolve: (value: any) => void; reject: (error: Error) => void }
export class Workers {
  private queue: Request[] = []; private slots: { worker: Worker; current?: Request }[] = []; private id = 0; private closed = false;
  constructor(count = 2) { for (let i = 0; i < count; i++) this.spawn(); }
  private spawn() {
    const slot: { worker: Worker; current?: Request } = { worker: new Worker(new URL('./worker.js', import.meta.url)) };
    slot.worker.on('message', ({ result, error }) => { if (error) slot.current?.reject(new Error(error)); else slot.current?.resolve(result); slot.current = undefined; this.pump(); });
    slot.worker.on('error', error => { slot.current?.reject(error); slot.current = undefined; });
    slot.worker.on('exit', () => { slot.current?.reject(new Error('Рабочий процесс завершился')); this.slots = this.slots.filter(s => s !== slot); if (!this.closed) { this.spawn(); this.pump(); } });
    this.slots.push(slot);
  }
  run<T>(task: string, args: unknown): Promise<T> { return new Promise((resolve, reject) => { if (this.closed) return reject(new Error('Сервис остановлен')); this.queue.push({ id: ++this.id, task, args, resolve, reject }); this.pump(); }); }
  private pump() { for (const slot of this.slots) if (!slot.current && this.queue.length) { slot.current = this.queue.shift()!; slot.worker.postMessage({ id: slot.current.id, task: slot.current.task, args: slot.current.args }); } }
  async close() { this.closed = true; for (const task of this.queue.splice(0)) task.reject(new Error('Сервис остановлен')); await Promise.all(this.slots.map(slot => slot.worker.terminate())); }
}

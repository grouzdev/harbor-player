import type { ListeningEvent } from "./pulse-recorder";

export interface PulseSettings {
  historyGeneration: number;
  enabled: boolean;
}
export interface PulseTransport {
  getSettings(): Promise<PulseSettings>;
  sendEvents(events: ListeningEvent[]): Promise<{
    historyGeneration: number;
    acknowledgements: { eventId: string; revision: number }[];
  }>;
}

/** Every mutation (including revision-aware ACK) is one durable transaction. */
export class PulseOutbox {
  private db: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const request = factory.open("harbor-player-pulse", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "eventId" });
        request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private async transaction(
    action: (store: IDBObjectStore, meta: IDBObjectStore) => void,
  ) {
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["events", "meta"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      action(tx.objectStore("events"), tx.objectStore("meta"));
    });
  }
  put(event: ListeningEvent) {
    return this.transaction((store, meta) => {
      const generation = meta.get("generation");
      generation.onsuccess = () => {
        if (generation.result !== event.historyGeneration) return;
        const request = store.get(event.eventId);
        request.onsuccess = () => {
          if (!request.result || request.result.revision < event.revision)
            store.put(event);
        };
      };
    });
  }
  reconcile(generation: number) {
    return this.transaction((store, meta) => {
      meta.put(generation, "generation");
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value.historyGeneration !== generation) cursor.delete();
        cursor.continue();
      };
    });
  }
  acknowledge(
    generation: number,
    acks: { eventId: string; revision: number }[],
  ) {
    return this.transaction((store) => {
      for (const ack of acks) {
        const request = store.get(ack.eventId);
        request.onsuccess = () => {
          const event = request.result as ListeningEvent | undefined;
          if (
            event?.historyGeneration === generation &&
            event.revision <= ack.revision
          )
            store.delete(ack.eventId);
        };
      }
    });
  }
  async pending(): Promise<ListeningEvent[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("events")
        .objectStore("events")
        .getAll(undefined, 100);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export class PulseDelivery {
  private running = false;
  private failures = 0;
  private nextAttempt = 0;
  constructor(
    private outbox: PulseOutbox,
    private transport: PulseTransport,
    private settings: (settings: PulseSettings) => void,
    private report: (error: unknown) => void,
    private now = () => Date.now(),
  ) {}
  async flush(force = false) {
    if (force) this.nextAttempt = 0;
    if (this.running || this.now() < this.nextAttempt) return false;
    this.running = true;
    try {
      const settings = await this.transport.getSettings();
      await this.outbox.reconcile(settings.historyGeneration);
      this.settings(settings);
      const events = await this.outbox.pending();
      if (settings.enabled && events.length) {
        const response = await this.transport.sendEvents(events);
        if (response.historyGeneration !== settings.historyGeneration) {
          await this.outbox.reconcile(response.historyGeneration);
          this.settings({
            ...settings,
            historyGeneration: response.historyGeneration,
          });
        } else
          await this.outbox.acknowledge(
            response.historyGeneration,
            response.acknowledgements,
          );
      }
      this.failures = 0;
      this.nextAttempt = 0;
      return true;
    } catch (error) {
      this.nextAttempt =
        this.now() + Math.min(60_000, 1000 * 2 ** this.failures++);
      this.report(error);
      return false;
    } finally {
      this.running = false;
    }
  }
}

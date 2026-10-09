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
  private db: Promise<IDBDatabase> | null = null;
  // A failed local write is retried while this window lives. This is not durable
  // storage: closing the window with IndexedDB unavailable can still lose it.
  private unsaved = new Map<string, ListeningEvent>();
  constructor(private factory: IDBFactory = indexedDB) {}
  private connect() {
    if (this.db) return this.db;
    const connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open("harbor-player-pulse", 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "eventId" });
        request.result.createObjectStore("meta");
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Открытие хранилища истории заблокировано"));
      };
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          this.db = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
    this.db = connection;
    void connection.catch(() => {
      if (this.db === connection) this.db = null;
    });
    return connection;
  }
  get unsavedCount() {
    return this.unsaved.size;
  }
  private async transaction(
    action: (store: IDBObjectStore, meta: IDBObjectStore) => void,
  ) {
    const db = await this.connect();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["events", "meta"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      action(tx.objectStore("events"), tx.objectStore("meta"));
    });
  }
  async put(event: ListeningEvent) {
    const previous = this.unsaved.get(event.eventId);
    if (!previous || previous.revision < event.revision)
      this.unsaved.set(event.eventId, structuredClone(event));
    await this.persist(event);
  }
  private async persist(event: ListeningEvent) {
    let storedGeneration: number | undefined;
    await this.transaction((store, meta) => {
      const generation = meta.get("generation");
      generation.onsuccess = () => {
        storedGeneration = generation.result;
        if (generation.result !== event.historyGeneration) return;
        const request = store.get(event.eventId);
        request.onsuccess = () => {
          if (!request.result || request.result.revision < event.revision)
            store.put(event);
        };
      };
    });
    if (
      storedGeneration === undefined ||
      storedGeneration < event.historyGeneration
    )
      throw new Error("Сначала согласуйте поколение хранилища истории");
    const retained = this.unsaved.get(event.eventId);
    if (retained && retained.revision <= event.revision)
      this.unsaved.delete(event.eventId);
  }
  async reconcile(generation: number) {
    let current = generation;
    await this.transaction((store, meta) => {
      const stored = meta.get("generation");
      stored.onsuccess = () => {
        // Another window may have already observed clear/re-enable. A delayed
        // settings response must never move the shared outbox backwards.
        current = Math.max(generation, stored.result ?? generation);
        meta.put(current, "generation");
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (cursor.value.historyGeneration !== current) cursor.delete();
          cursor.continue();
        };
      };
    });
    for (const [id, event] of this.unsaved)
      if (event.historyGeneration < current) this.unsaved.delete(id);
    return current;
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
    for (const event of this.unsaved.values()) await this.persist(event);
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("events");
      const request = tx.objectStore("events").getAll(undefined, 100);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
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
  private async refreshSettings() {
    let settings = await this.transport.getSettings();
    let generation = await this.outbox.reconcile(settings.historyGeneration);
    if (generation !== settings.historyGeneration) {
      settings = await this.transport.getSettings();
      generation = await this.outbox.reconcile(settings.historyGeneration);
      if (generation !== settings.historyGeneration) return null;
    }
    this.settings(settings);
    return settings;
  }
  async flush(force = false) {
    if (force) this.nextAttempt = 0;
    if (this.running || this.now() < this.nextAttempt) return false;
    this.running = true;
    try {
      const settings = await this.refreshSettings();
      if (!settings) return false;
      const events = await this.outbox.pending();
      if (settings.enabled && events.length) {
        const response = await this.transport.sendEvents(events);
        if (response.historyGeneration !== settings.historyGeneration) {
          await this.outbox.reconcile(response.historyGeneration);
          // Refresh enabled as well: a generation alone is not a settings
          // snapshot and may be accompanied by a disable in another window.
          if (!(await this.refreshSettings())) return false;
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

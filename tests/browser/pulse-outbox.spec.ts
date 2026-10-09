import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { expect, test, type Page } from "@playwright/test";

async function prepareOutboxModule(page: Page) {
  await page.route("http://pulse.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("http://pulse.test");
  return stripTypeScriptTypes(
    readFileSync("src/client/pulse-outbox.ts", "utf8"),
    { mode: "transform" },
  );
}

test("durable IndexedDB coalesces revisions, rejects late ACK and stale generation writes", async ({
  page,
}) => {
  await page.route("http://pulse.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto("http://pulse.test");
  const source = stripTypeScriptTypes(
    readFileSync("src/client/pulse-outbox.ts", "utf8"),
    {
      mode: "transform",
    },
  );
  const results = await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(
      new Blob([moduleSource], { type: "text/javascript" }),
    );
    const { PulseOutbox, PulseDelivery } = await new Function(
      "url",
      "return import(url)",
    )(url);
    const box = new PulseOutbox();
    await box.reconcile(1);
    const event = {
      eventId: "one",
      revision: 1,
      historyGeneration: 1,
      playedMs: 15000,
    };
    await box.put(event);
    await box.put({ ...event, revision: 2, playedMs: 30000 });
    await box.put(event);
    await box.acknowledge(1, [{ eventId: "one", revision: 1 }]);
    const retained = await new PulseOutbox().pending();
    await box.acknowledge(1, [{ eventId: "one", revision: 2 }]);
    const removed = await box.pending();
    await box.put(event);
    await box.reconcile(2);
    await box.put({ ...event, revision: 3 });
    const cleared = await box.pending();
    let clock = 0;
    let calls = 0;
    const delivery = new PulseDelivery(
      box,
      {
        getSettings: async () => {
          calls++;
          throw new Error("offline");
        },
        sendEvents: async () => {
          throw new Error("unexpected");
        },
      },
      () => {},
      () => {},
      () => clock,
    );
    await delivery.flush();
    await delivery.flush();
    const initialCalls = calls;
    clock = 1000;
    await delivery.flush();
    return { retained, removed, cleared, initialCalls, calls };
  }, source);
  expect(results.retained).toHaveLength(1);
  expect(results.retained[0].revision).toBe(2);
  expect(results.removed).toEqual([]);
  expect(results.cleared).toEqual([]);
  expect(results.initialCalls).toBe(1);
  expect(results.calls).toBe(2);
});

test("outbox retries opening, aborted and quota-failed writes without losing the latest revision", async ({
  page,
}) => {
  const source = await prepareOutboxModule(page);
  const result = await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(
      new Blob([moduleSource], { type: "text/javascript" }),
    );
    const { PulseOutbox } = await new Function("url", "return import(url)")(
      url,
    );
    let unavailable = true;
    const factory = {
      open: (...args: Parameters<IDBFactory["open"]>) => {
        if (unavailable) throw new DOMException("unavailable", "SecurityError");
        return indexedDB.open(...args);
      },
    };
    const box = new PulseOutbox(factory);
    const failedOpen = await box.pending().then(
      () => false,
      () => true,
    );
    unavailable = false;
    await box.reconcile(1);
    const original = IDBObjectStore.prototype.put;
    let failure: "abort" | "quota" | null = "abort";
    IDBObjectStore.prototype.put = function (...args) {
      if (failure === "quota" && this.name === "events")
        throw new DOMException("injected quota failure", "QuotaExceededError");
      const request = original.apply(this, args);
      if (failure === "abort" && this.name === "events")
        this.transaction.abort();
      return request;
    };
    const event = {
      eventId: "failed-write",
      revision: 1,
      historyGeneration: 1,
      playedMs: 15000,
    };
    const failedWrite = await box.put(event).then(
      () => false,
      () => true,
    );
    failure = "quota";
    const failedQuota = await box
      .put({ ...event, revision: 2, playedMs: 30000 })
      .then(
        () => false,
        () => true,
      );
    const retainedInMemory = box.unsavedCount;
    failure = null;
    const recovered = await box.pending();
    IDBObjectStore.prototype.put = original;
    const durable = await new PulseOutbox().pending();
    return {
      failedOpen,
      failedWrite,
      failedQuota,
      retainedInMemory,
      recovered,
      durable,
      unsaved: box.unsavedCount,
    };
  }, source);
  expect(result.failedOpen).toBe(true);
  expect(result.failedWrite).toBe(true);
  expect(result.failedQuota).toBe(true);
  expect(result.retainedInMemory).toBe(1);
  expect(result.recovered).toMatchObject([{ revision: 2, playedMs: 30000 }]);
  expect(result.durable).toEqual(result.recovered);
  expect(result.unsaved).toBe(0);
});

test("an older window cannot roll back generation or delete new pending events", async ({
  page,
}) => {
  const source = await prepareOutboxModule(page);
  const result = await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(
      new Blob([moduleSource], { type: "text/javascript" }),
    );
    const { PulseOutbox, PulseDelivery } = await new Function(
      "url",
      "return import(url)",
    )(url);
    const olderWindow = new PulseOutbox();
    const newerWindow = new PulseOutbox();
    await olderWindow.reconcile(1);
    await newerWindow.reconcile(2);
    const event = {
      eventId: "new-generation",
      revision: 1,
      historyGeneration: 2,
      playedMs: 1000,
    };
    await newerWindow.put(event);
    const effectiveGeneration = await olderWindow.reconcile(1);
    await olderWindow.put({ ...event, eventId: "stale", historyGeneration: 1 });
    const preserved = await newerWindow.pending();
    let reads = 0;
    const applied: number[] = [];
    const sent: number[] = [];
    const delivery = new PulseDelivery(
      olderWindow,
      {
        getSettings: async () => ({
          historyGeneration: ++reads === 1 ? 1 : 2,
          enabled: true,
        }),
        sendEvents: async (events: { historyGeneration: number }[]) => {
          sent.push(events[0].historyGeneration);
          return {
            historyGeneration: 2,
            acknowledgements: [{ eventId: event.eventId, revision: 1 }],
          };
        },
      },
      (settings: { historyGeneration: number }) =>
        applied.push(settings.historyGeneration),
      () => {},
    );
    await delivery.flush();
    return {
      effectiveGeneration,
      preserved,
      applied,
      sent,
      remaining: await newerWindow.pending(),
    };
  }, source);
  expect(result.effectiveGeneration).toBe(2);
  expect(result.preserved).toMatchObject([{ eventId: "new-generation" }]);
  expect(result.applied).toEqual([2]);
  expect(result.sent).toEqual([2]);
  expect(result.remaining).toEqual([]);
});

test("delivery survives a lost ACK and retains newer revision until generation clear", async ({
  page,
}) => {
  const source = await prepareOutboxModule(page);
  const result = await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(
      new Blob([moduleSource], { type: "text/javascript" }),
    );
    const { PulseOutbox, PulseDelivery } = await new Function(
      "url",
      "return import(url)",
    )(url);
    const box = new PulseOutbox();
    await box.reconcile(1);
    const event = {
      eventId: "in-flight",
      revision: 1,
      historyGeneration: 1,
      playedMs: 15000,
    };
    await box.put(event);
    let generation = 1;
    let loseResponse = true;
    let accepted = 0;
    let clock = 0;
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const barrier = new Promise<void>((resolve) => (release = resolve));
    let block = false;
    const delivery = new PulseDelivery(
      box,
      {
        getSettings: async () => ({
          historyGeneration: generation,
          enabled: true,
        }),
        sendEvents: async (
          events: { revision: number; playedMs: number }[],
        ) => {
          const payload = events[0];
          accepted = Math.max(accepted, payload.playedMs);
          if (loseResponse) {
            loseResponse = false;
            throw new Error("response lost after commit");
          }
          if (block) {
            entered!();
            await barrier;
          }
          return {
            historyGeneration: 1,
            acknowledgements: [
              { eventId: event.eventId, revision: payload.revision },
            ],
          };
        },
      },
      () => {},
      () => {},
      () => clock,
    );
    await delivery.flush();
    const afterLostAck = await box.pending();
    clock = 1000;
    block = true;
    const sending = delivery.flush();
    await started;
    await box.put({ ...event, revision: 2, playedMs: 30000 });
    release!();
    await sending;
    const afterLateAck = await box.pending();
    generation = 2;
    await new PulseOutbox().reconcile(2);
    await delivery.flush(true);
    return {
      accepted,
      afterLostAck,
      afterLateAck,
      cleared: await box.pending(),
    };
  }, source);
  expect(result.accepted).toBe(15000);
  expect(result.afterLostAck).toMatchObject([{ revision: 1 }]);
  expect(result.afterLateAck).toMatchObject([{ revision: 2 }]);
  expect(result.cleared).toEqual([]);
});

test("POST generation change followed by another clear reconciles before recorder writes", async ({
  page,
}) => {
  const source = await prepareOutboxModule(page);
  const result = await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(
      new Blob([moduleSource], { type: "text/javascript" }),
    );
    const { PulseOutbox, PulseDelivery } = await new Function(
      "url",
      "return import(url)",
    )(url);
    const box = new PulseOutbox();
    const other = new PulseOutbox();
    const event = {
      eventId: "generation-two",
      revision: 1,
      historyGeneration: 2,
      playedMs: 1000,
    };
    const originalPending = box.pending.bind(box);
    let race = true;
    box.pending = async () => {
      if (race) {
        race = false;
        await other.reconcile(2);
        await other.put(event);
      }
      return originalPending();
    };
    let reads = 0;
    let written: Promise<void> = Promise.resolve();
    const applied: number[] = [];
    const delivery = new PulseDelivery(
      box,
      {
        getSettings: async () => ({
          historyGeneration: ++reads === 1 ? 1 : 3,
          enabled: true,
        }),
        sendEvents: async () => ({
          historyGeneration: 2,
          acknowledgements: [{ eventId: event.eventId, revision: 1 }],
        }),
      },
      (settings: { historyGeneration: number }) => {
        applied.push(settings.historyGeneration);
        if (settings.historyGeneration === 3)
          written = box.put({
            ...event,
            eventId: "generation-three",
            historyGeneration: 3,
          });
      },
      () => {},
    );
    await delivery.flush();
    await written;
    return { applied, pending: await originalPending() };
  }, source);
  expect(result.applied).toEqual([1, 3]);
  expect(result.pending).toMatchObject([
    { eventId: "generation-three", historyGeneration: 3 },
  ]);
});

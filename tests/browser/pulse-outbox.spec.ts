import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { expect, test } from "@playwright/test";

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/client/api";
import { createPulseApiAdapter } from "../src/client/PulseMode";

vi.mock("../src/client/api", () => ({ api: vi.fn() }));
const request = vi.mocked(api);
const signal = () => new AbortController().signal;
const album = {
  albumId: "album",
  title: "Album",
  artists: ["Artist"],
  coverId: null,
  playedMs: 60_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  request.mockImplementation(async (path) => {
    if (path === "/pulse/history-range")
      return {
        firstDay: "2025-01-01",
        lastDay: "2025-01-01",
        enabled: true,
        historyGeneration: 1,
        timeZone: "UTC",
      };
    if (path.includes("/stats"))
      return {
        ...album,
        dayCount: 1,
        sameDayReturns: 0,
        firstPlayedAtUtc: Date.parse("2025-01-01"),
        lastPlayedAtUtc: Date.parse("2025-01-01"),
        dayPlayedMs: 60_000,
        dayTotalMs: 60_000,
      };
    return { items: [album] };
  });
});
afterEach(() => vi.useRealTimers());

describe("Pulse API bounded caches", () => {
  it.each([
    { kind: "pages", maximum: 24 },
    { kind: "stats", maximum: 16 },
  ])(
    "bounds $kind, refreshes LRU and expires at TTL",
    async ({ kind, maximum }) => {
      const adapter = createPulseApiAdapter();
      await adapter.history(signal());
      const read = (index: number) =>
        kind === "pages"
          ? adapter.albums("2025-01-01", index * 20, 20, signal())
          : adapter.stats(`album-${index}`, "2025-01-01", signal());
      for (let index = 0; index < maximum; index++) await read(index);
      let calls = request.mock.calls.length;
      await read(0);
      expect(request).toHaveBeenCalledTimes(calls);
      await read(maximum);
      calls++;
      await read(0);
      expect(request).toHaveBeenCalledTimes(calls);
      await read(1); // Least-recently-used, not the refreshed first entry.
      expect(request).toHaveBeenCalledTimes(++calls);
      vi.advanceTimersByTime(30_001);
      await read(0);
      expect(request).toHaveBeenCalledTimes(++calls);
      adapter.invalidate?.();
      await read(0);
      expect(request).toHaveBeenCalledTimes(++calls);
      await adapter.history(signal());
      await read(0);
      expect(request).toHaveBeenCalledTimes(calls + 2);
    },
  );

  it.each(["pages", "stats"])(
    "does not cache delayed %s after invalidation or abort",
    async (kind) => {
      const adapter = createPulseApiAdapter();
      await adapter.history(signal());
      const read = (s: AbortSignal) =>
        kind === "pages"
          ? adapter.albums("2025-01-01", 0, 20, s)
          : adapter.stats("album", "2025-01-01", s);
      for (const abort of [false, true]) {
        const controller = new AbortController();
        let release!: (value: never) => void;
        request.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        );
        const pending = read(controller.signal);
        if (abort) controller.abort();
        else adapter.invalidate?.();
        release(
          (kind === "pages"
            ? { items: [album] }
            : {
                ...album,
                firstPlayedAtUtc: Date.parse("2025-01-01"),
                lastPlayedAtUtc: Date.parse("2025-01-01"),
              }) as never,
        );
        await pending;
        const calls = request.mock.calls.length;
        await read(signal());
        expect(request).toHaveBeenCalledTimes(calls + 1);
        adapter.invalidate?.();
      }
    },
  );
});

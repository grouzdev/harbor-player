import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/client/api";
import {
  createPulseApiAdapter,
  readPulseLayout,
  type PulseAdapter,
} from "../src/client/PulseMode";
import { calendarDay } from "../src/client/pulse-layout";

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

describe("Pulse layout read scheduling", () => {
  it("bounds concurrent reads, preserves window order and fetches fresh metadata", async () => {
    let active = 0;
    let maximum = 0;
    const releases: (() => void)[] = [];
    const layout = vi.fn<PulseAdapter["layout"]>(
      (from, _to, signal) =>
        new Promise((resolve) => {
          expect(signal.aborted).toBe(false);
          maximum = Math.max(maximum, ++active);
          releases.push(() => {
            active--;
            resolve([
              { date: from, playedMs: 100, albumCount: 1, maxAlbumMs: 100 },
            ]);
          });
        }),
    );
    const load = () =>
      readPulseLayout({ layout }, "2016-01-01", "2025-12-31", signal());
    const pending = load();
    expect(layout).toHaveBeenCalledTimes(3);
    // Deliberately finish each initial window out of order.
    for (const index of [2, 1, 0, 3, 4, 5, 6, 7, 8, 9]) {
      releases[index]();
      await Promise.resolve();
    }
    const result = await pending;
    expect(maximum).toBe(3);
    expect(layout).toHaveBeenCalledTimes(10);
    expect(result.map((day) => day.date)).toEqual(
      layout.mock.calls.map(([from]) => from),
    );
    for (const [index, [from, to]] of layout.mock.calls.entries()) {
      expect(calendarDay(to) - calendarDay(from)).toBeLessThanOrEqual(365);
      if (index > 0)
        expect(calendarDay(from)).toBe(
          calendarDay(layout.mock.calls[index - 1][1]) + 1,
        );
    }
    expect(layout.mock.calls.at(-1)?.[1]).toBe("2025-12-31");
    layout.mockResolvedValue([]);
    await load();
    expect(layout).toHaveBeenCalledTimes(20); // No stale metadata cache.
  });

  it("uses one read for a short history", async () => {
    const layout = vi.fn<PulseAdapter["layout"]>().mockResolvedValue([]);
    await readPulseLayout({ layout }, "2024-02-28", "2024-03-01", signal());
    expect(layout).toHaveBeenCalledTimes(1);
    expect(layout.mock.calls[0].slice(0, 2)).toEqual([
      "2024-02-28",
      "2024-03-01",
    ]);
  });

  it.each(["abort", "failure"] as const)(
    "cancels siblings and stops scheduling after %s",
    async (kind) => {
      const parent = new AbortController();
      const failure = new Error("layout unavailable");
      let rejectFirst!: (reason: unknown) => void;
      const layout = vi.fn<PulseAdapter["layout"]>(
        (_from, _to, signal) =>
          new Promise((_resolve, reject) => {
            rejectFirst ??= reject;
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      const pending = readPulseLayout(
        { layout },
        "2016-01-01",
        "2025-12-31",
        parent.signal,
      );
      const assertion = expect(pending).rejects.toThrow(
        kind === "failure" ? failure : /abort/i,
      );
      if (kind === "abort") parent.abort();
      else rejectFirst(failure);
      await assertion;
      expect(layout).toHaveBeenCalledTimes(3);
      expect(layout.mock.calls.every(([, , signal]) => signal.aborted)).toBe(
        true,
      );
    },
  );

  it("does not start reads for an already aborted request", async () => {
    const controller = new AbortController();
    const reason = new Error("history replaced");
    controller.abort(reason);
    const layout = vi.fn<PulseAdapter["layout"]>();
    await expect(
      readPulseLayout(
        { layout },
        "2025-01-01",
        "2025-12-31",
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(layout).not.toHaveBeenCalled();
  });
});

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

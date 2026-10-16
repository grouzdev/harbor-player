import { describe, expect, it, vi } from "vitest";
import {
  distribution,
  summarize,
  networkSummary,
  installUiProbe,
  tasksOverlappingSample,
} from "../scripts/pulse-ui-evidence.mjs";
import { uiBenchmarkOptions } from "../scripts/pulse-ui-options.mjs";

describe("Pulse UI evidence", () => {
  it("bounds diagnostic launches and budgets every retained dataset fixture", () => {
    expect(uiBenchmarkOptions([])).toMatchObject({
      launches: 10,
      retainedCopies: 20,
    });
    expect(uiBenchmarkOptions(["--smoke"])).toMatchObject({
      launches: 1,
      retainedCopies: 2,
    });
    for (const count of [1, 5]) {
      expect(
        uiBenchmarkOptions([
          "--smoke",
          "--diagnostic",
          `--diagnostic-runs=${count}`,
        ]),
      ).toMatchObject({
        launches: count,
        retainedCopies: count * 2,
        smoke: true,
        diagnostic: true,
      });
    }
    for (const args of [
      ["--diagnostic"],
      ["--smoke", "--diagnostic-runs=1"],
      ["--diagnostic", "--diagnostic-runs=5"],
      ["--smoke", "--diagnostic", "--diagnostic-runs=0"],
      ["--smoke", "--diagnostic", "--diagnostic-runs=6"],
    ])
      expect(() => uiBenchmarkOptions(args)).toThrow();
  });
  it("keeps diagnostic and ordinary readiness identical through cancellation and delayed data", async () => {
    const readiness = [];
    for (const diagnostic of [false, true]) {
      const queue: FrameRequestCallback[] = [];
      let clock = 0;
      let loaded = false;
      let loading = false;
      let hidden = false;
      let focused = true;
      const contextListeners = new Map<
        string,
        Set<(event: { type: string }) => void>
      >();
      let mutation = () => {};
      let click: (event: unknown) => void = () => {};
      const element = {
        isConnected: true,
        textContent: "initial card and stats",
        closest: () => null,
        getBoundingClientRect: () => ({
          width: 100,
          height: 100,
          left: 0,
          right: 100,
          top: 0,
          bottom: 100,
        }),
      };
      let statsElement = element;
      const image = {
        ...element,
        currentSrc: "http://127.0.0.1/api/covers/corrupt.png",
        decode: () => Promise.reject(new Error("Corrupt fixture")),
        complete: true,
      };
      const addContextListener = (
        name: string,
        handler: (event: { type: string }) => void,
      ) => {
        if (!contextListeners.has(name)) contextListeners.set(name, new Set());
        contextListeners.get(name)!.add(handler);
      };
      const removeContextListener = (
        name: string,
        handler: (event: { type: string }) => void,
      ) => {
        const listeners = contextListeners.get(name);
        listeners?.delete(handler);
        if (!listeners?.size) contextListeners.delete(name);
      };
      const contextEvent = (type: string) =>
        contextListeners.get(type)?.forEach((listener) => listener({ type }));
      const windowMock: Record<string, any> = {
        addEventListener: addContextListener,
        removeEventListener: removeContextListener,
      };
      vi.stubGlobal("window", windowMock);
      vi.stubGlobal("innerWidth", 900);
      vi.stubGlobal("innerHeight", 900);
      vi.stubGlobal("performance", {
        now: () => clock,
        getEntriesByType: () => [],
      });
      vi.stubGlobal("PerformanceObserver", { supportedEntryTypes: [] });
      vi.stubGlobal(
        "MutationObserver",
        class {
          constructor(callback: () => void) {
            mutation = callback;
          }
          observe = vi.fn();
          disconnect = vi.fn();
        },
      );
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        queue.push(callback),
      );
      vi.stubGlobal("document", {
        documentElement: {},
        get visibilityState() {
          return hidden ? "hidden" : "visible";
        },
        hasFocus: () => focused,
        fonts: { status: "loaded" },
        addEventListener: (name: string, handler: typeof click) => {
          if (name === "click") click = handler;
          else addContextListener(name, handler);
        },
        removeEventListener: removeContextListener,
        querySelector: (selector: string) =>
          selector === ".pulse-mode" || selector === ".pulse-rail"
            ? element
            : selector === ".pulse-stat-numbers" && loaded
              ? statsElement
              : null,
        querySelectorAll: (selector: string) =>
          selector === ".pulse-album" && loaded
            ? [element]
            : selector === ".pulse-card-loading" && loading
              ? [element]
              : selector === ".pulse-mode img"
                ? [image]
                : [],
      });
      const frame = async () => {
        clock += 16;
        const callbacks = queue.splice(0);
        callbacks.forEach((callback) => callback(clock));
        await Promise.resolve();
      };
      try {
        installUiProbe({ diagnostic });
        // Initial click must see no Pulse DOM (activation, not return).
        const doc = globalThis.document;
        const query = doc.querySelector;
        doc.querySelector = (() => null) as typeof query;
        click({ target: { closest: () => element } });
        const cancelled = windowMock.__pulseUiProbe.sample;
        click({ target: { closest: () => element } });
        doc.querySelector = query;
        await frame();
        await frame();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        // A delayed API must not allow unbounded diagnostic buffers.
        for (let i = 0; i < 200; i++) await frame();
        loaded = true;
        mutation();
        hidden = true;
        contextEvent("visibilitychange");
        focused = false;
        contextEvent("blur");
        for (let i = 0; i < 3; i++) await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        hidden = false;
        contextEvent("visibilitychange");
        focused = true;
        contextEvent("focus");
        for (let i = 0; i < 70; i++) contextEvent("focus");
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        loading = true;
        await frame();
        loading = false;
        await frame();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        element.textContent = "mutated card and stats";
        await frame();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        statsElement = { ...element, textContent: "replaced statistics" };
        await frame();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.dataReady).toBe(clock);
        expect(windowMock.__pulseUiProbe.sample.coversReady).toBeNull();
        loading = true;
        await frame();
        await frame();
        expect(windowMock.__pulseUiProbe.sample.coversReady).toBeNull();
        loading = false;
        for (let i = 0; i < 6; i++) await frame();
        expect(windowMock.__pulseUiProbe.sample.coversReady).toBeGreaterThan(
          windowMock.__pulseUiProbe.sample.dataReady,
        );
        expect(cancelled.dataReady).toBeNull();
        const sample = windowMock.__pulseUiProbe.sample;
        readiness.push({
          shellReady: sample.shellReady,
          dataReady: sample.dataReady,
          coversReady: sample.coversReady,
          covers: sample.covers,
        });
        if (diagnostic) {
          expect(
            windowMock.__pulseUiProbe.sample.phases.shellDomObserved,
          ).toBeLessThan(windowMock.__pulseUiProbe.sample.dataReady);
          expect(windowMock.__pulseUiProbe.sample.covers[0].status).toBe(
            "error",
          );
          const phases = windowMock.__pulseUiProbe.sample.phases;
          expect(phases.raf[0]).toMatchObject({
            purpose: "initial-opportunity-1",
            requestedMs: 0,
            firedMs: 16,
            callbackTimestampMs: 16,
            waitMs: 16,
            visibilityAtRequest: "visible",
            visibilityAtFire: "visible",
          });
          expect(phases.raf).toHaveLength(180);
          expect(phases.rafDropped).toBeGreaterThan(0);
          expect(phases.decodeRaf.length).toBeLessThanOrEqual(16);
          expect(
            phases.decodeRaf.slice(-2).map((entry: any) => entry.purpose),
          ).toEqual(["decode-opportunity-1", "decode-opportunity-2"]);
          for (const entry of phases.decodeRaf.slice(-2)) {
            expect(entry.firedMs).toBeGreaterThan(entry.requestedMs);
            expect(entry.waitMs).toBeGreaterThan(0);
          }
          expect(phases.contextChanges).toHaveLength(64);
          expect(phases.contextChangesDropped).toBeGreaterThan(0);
          expect(phases.contextChanges[0]).toMatchObject({
            event: "visibilitychange",
            visibility: "hidden",
          });
          expect(phases.contextChanges[1]).toMatchObject({
            event: "blur",
            focused: false,
          });
          expect(contextListeners.size).toBe(0);
          expect(cancelled.phases.cancelledAtMs).toBe(0);
          expect(cancelled.phases.raf[0].firedMs).toBeNull();
        }
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(readiness[0]).toEqual(readiness[1]);
  });
  it("attributes only long tasks overlapping the renderer sample interval", () => {
    const tasks = [
      { startTime: 0, duration: 100 }, // Ends exactly at click: excluded.
      { startTime: 80, duration: 50 }, // Crosses click: retained.
      { startTime: 120, duration: 60 },
      { startTime: 199, duration: 50 }, // Crosses completion: retained.
      { startTime: 200, duration: 60 }, // Post-sample validation: excluded.
    ];
    expect(
      tasksOverlappingSample(tasks, { start: 100, coversReady: 100 }),
    ).toEqual(tasks.slice(1, 4));
  });
  it("requires a confirmed empty state without stale selection or statistics", async () => {
    const frames: FrameRequestCallback[] = [];
    let clock = 0;
    let entered = false;
    let staleStats = true;
    let staleTitle = true;
    let message = "Загрузка истории…";
    let click: (event: unknown) => void = () => {};
    const windowMock: Record<string, any> = {};
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal("PerformanceObserver", { supportedEntryTypes: [] });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (_name: string, callback: typeof click) => {
        click = callback;
      },
      querySelectorAll: () => [],
      querySelector: (selector: string) => {
        if (selector === ".pulse-mode") return entered ? {} : null;
        if (selector === ".pulse-empty[role='status']")
          return { textContent: message };
        if (selector === ".pulse-stat-numbers") return staleStats ? {} : null;
        if (selector === ".pulse-copy h2") return staleTitle ? {} : null;
        return null;
      },
    });
    const advance = async (count: number) => {
      for (let index = 0; index < count; index++) {
        clock += 16;
        frames.splice(0).forEach((callback) => callback(clock));
        await Promise.resolve();
      }
    };
    try {
      installUiProbe();
      windowMock.__pulseUiProbe.expected = { empty: true };
      click({ target: { closest: () => ({}) } });
      entered = true;
      await advance(5);
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      message = "История прослушивания пока пуста";
      await advance(4);
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      staleStats = false;
      await advance(4);
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      staleTitle = false;
      await advance(6);
      expect(windowMock.__pulseUiProbe.sample.coversReady).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("retains failed, canceled and unknown-byte requests rather than treating them as successful zero-byte transfers", () => {
    const summary = networkSummary([
      { endpoint: "/api/covers/x", bytes: 120, status: 404 },
      {
        endpoint: "/api/pulse/layout",
        bytes: null,
        status: null,
        canceled: true,
        error: "canceled",
      },
    ]);
    expect(summary.coverRequests).toBe(1);
    expect(summary.totalRequests).toBe(2);
    expect(summary.byEndpoint["/api/pulse/layout"]).toEqual({
      requests: 1,
      bytes: 0,
      failed: 1,
      canceled: 1,
      unknownBytes: 1,
    });
  });
  it("uses nearest-rank quantiles without mutating raw samples", () => {
    const raw = [9, 1, 3, 2];
    expect(distribution(raw)).toEqual({
      count: 4,
      medianMs: 2,
      p95Ms: 9,
      maxMs: 9,
    });
    expect(raw).toEqual([9, 1, 3, 2]);
    expect(distribution([])).toBeNull();
    expect(() => distribution([NaN])).toThrow();
  });
  it("does not turn fast smoke or browser numbers into budget acceptance", () => {
    const samples = [
      {
        dataset: "ordinary",
        kind: "cold",
        shellReady: 1,
        dataReady: 2,
        coversReady: 3,
      },
    ];
    const browser = summarize(samples, "browser")["ordinary/cold"];
    expect(browser.sampleCountSufficient).toBe(false);
    expect(browser.budgetAcceptance).toContain("NOT APPLICABLE");
    expect(
      summarize(samples, "electron")["ordinary/cold"].budgetAcceptance,
    ).toContain("NOT RUN");
    const foreground = {
      ...samples[0],
      coldScenario: "ready-panels",
      contextAtClick: { visible: true, focused: true },
      contextAtReady: { visible: true, focused: true },
      nativeWindowBeforeCommand: {
        visible: false,
        focused: false,
        minimized: false,
      },
      nativeWindowAfterReadiness: {
        visible: true,
        focused: true,
        minimized: false,
      },
    };
    expect(
      summarize([foreground], "browser")["ordinary/cold"].guideApplicable,
    ).toBe(true);
    expect(
      summarize([foreground], "electron")["ordinary/cold"].guideApplicable,
    ).toBe(false);
    expect(
      summarize(
        [{ ...foreground, coldScenario: "startup-overlap" }],
        "browser",
      )["ordinary/cold"].diagnosticP95WithinGuide,
    ).toBeNull();
  });
});

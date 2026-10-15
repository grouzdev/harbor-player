import { describe, expect, it, vi } from "vitest";
import {
  distribution,
  summarize,
  networkSummary,
  installUiProbe,
} from "../scripts/pulse-ui-evidence.mjs";

describe("Pulse UI evidence", () => {
  it.each([false, true])("probe lifecycle %s", async (diagnostic) => {
    const queue: FrameRequestCallback[] = [];
    let clock = 0;
    let loaded = false;
    let loading = false;
    let hidden = false;
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
    const windowMock: Record<string, any> = {};
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
      hasFocus: () => true,
      fonts: { status: "loaded" },
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler;
      },
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
            : selector === ".pulse-mode img" && diagnostic
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
      loaded = true;
      mutation();
      hidden = true;
      for (let i = 0; i < 3; i++) await frame();
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      hidden = false;
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
      if (diagnostic) {
        expect(
          windowMock.__pulseUiProbe.sample.phases.shellDomObserved,
        ).toBeLessThan(windowMock.__pulseUiProbe.sample.dataReady);
        expect(windowMock.__pulseUiProbe.sample.covers[0].status).toBe("error");
      }
    } finally {
      vi.unstubAllGlobals();
    }
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

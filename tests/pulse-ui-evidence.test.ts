import { describe, expect, it, vi } from "vitest";
import {
  distribution,
  summarize,
  networkSummary,
  installUiProbe,
} from "../scripts/pulse-ui-evidence.mjs";

describe("Pulse UI evidence", () => {
  it("waits rendering opportunities relative to async readiness and revalidates DOM", async () => {
    const queue: FrameRequestCallback[] = [];
    let clock = 0;
    let loaded = false;
    let loading = false;
    let click: (event: unknown) => void = () => {};
    const element = {
      isConnected: true,
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
    const windowMock: Record<string, any> = {};
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("innerWidth", 900);
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal("PerformanceObserver", { supportedEntryTypes: [] });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      queue.push(callback),
    );
    vi.stubGlobal("document", {
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler;
      },
      querySelector: (selector: string) =>
        selector === ".pulse-mode" || selector === ".pulse-rail"
          ? element
          : selector === ".pulse-stat-numbers" && loaded
            ? element
            : null,
      querySelectorAll: (selector: string) =>
        selector === ".pulse-album" && loaded
          ? [element]
          : selector === ".pulse-card-loading" && loading
            ? [element]
            : [],
    });
    const frame = async () => {
      clock += 16;
      const callbacks = queue.splice(0);
      callbacks.forEach((callback) => callback(clock));
      await Promise.resolve();
    };
    try {
      installUiProbe();
      // Initial click must see no Pulse DOM (activation, not return).
      const doc = globalThis.document;
      const query = doc.querySelector;
      doc.querySelector = (() => null) as typeof query;
      click({ target: { closest: () => element } });
      doc.querySelector = query;
      await frame();
      await frame();
      await frame();
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      loaded = true;
      await frame();
      expect(windowMock.__pulseUiProbe.sample.dataReady).toBeNull();
      loading = true;
      await frame();
      loading = false;
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
  });
});

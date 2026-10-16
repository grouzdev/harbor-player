export function distribution(samples) {
  if (!samples.length) return null;
  if (samples.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Latency evidence must be finite and nonnegative");
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}

/** All timestamps belong to the renderer clock; include tasks crossing click. */
export function tasksOverlappingSample(tasks, sample) {
  const end = sample.start + sample.coversReady;
  return tasks.filter(
    (task) =>
      task.startTime < end && task.startTime + task.duration > sample.start,
  );
}

export function networkSummary(rows) {
  const byEndpoint = {};
  for (const row of rows) {
    const bucket = (byEndpoint[row.endpoint] ??= {
      requests: 0,
      bytes: 0,
      failed: 0,
      canceled: 0,
      unknownBytes: 0,
    });
    bucket.requests++;
    if (row.bytes === null) bucket.unknownBytes++;
    else bucket.bytes += row.bytes;
    if (row.error || row.status >= 400) bucket.failed++;
    if (row.canceled) bucket.canceled++;
  }
  return {
    byEndpoint,
    coverRequests: rows.filter((r) => r.endpoint.startsWith("/api/covers/"))
      .length,
    totalRequests: rows.length,
    transferredBytes: rows.reduce((n, r) => n + (r.bytes ?? 0), 0),
  };
}

// Installed/manual acceptance never follows from a browser or packaged CDP run.
export function summarize(samples, target) {
  const groups = {};
  for (const sample of samples) {
    const key = `${sample.dataset}/${sample.kind}`;
    (groups[key] ??= []).push(sample);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([key, values]) => {
      const ready = distribution(values.map((value) => value.dataReady));
      const cold = key.endsWith("/cold");
      const foreground = values.every(
        (value) =>
          value.contextAtClick?.visible &&
          value.contextAtClick?.focused &&
          value.contextAtReady?.visible &&
          value.contextAtReady?.focused,
      );
      const nativeForeground =
        target !== "electron" ||
        values.every(
          (value) =>
            value.nativeWindowBeforeCommand?.visible &&
            value.nativeWindowBeforeCommand?.focused &&
            !value.nativeWindowBeforeCommand?.minimized &&
            value.nativeWindowAfterReadiness?.visible &&
            value.nativeWindowAfterReadiness?.focused &&
            !value.nativeWindowAfterReadiness?.minimized,
        );
      const guideApplicable =
        foreground &&
        (!cold ||
          (values.every((value) => value.coldScenario === "ready-panels") &&
            nativeForeground));
      return [
        key,
        {
          shellReady: distribution(values.map((value) => value.shellReady)),
          dataReady: ready,
          coversReady: distribution(values.map((value) => value.coversReady)),
          guideApplicable,
          diagnosticP95WithinGuide: guideApplicable
            ? ready.p95Ms < (cold ? 300 : 100)
            : null,
          sampleCountSufficient: values.length >= (cold ? 10 : 30),
          budgetAcceptance:
            target === "browser"
              ? "NOT APPLICABLE: browser diagnostics"
              : "NOT RUN: installed Windows manual proof required",
        },
      ];
    }),
  );
}

// Runs in the renderer. Event timestamps and readiness use the same clock.
export function installUiProbe({ diagnostic = false } = {}) {
  const visible = (element) => {
    const r = element.getBoundingClientRect();
    const rail = element.closest(".pulse-rail")?.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.right > Math.max(0, rail?.left ?? 0) &&
      r.left < Math.min(innerWidth, rail?.right ?? innerWidth) &&
      r.bottom > 0 &&
      r.top < innerHeight
    );
  };
  const semantics = (cards) =>
    JSON.stringify({
      cards: cards.map((card) => ({
        label: card.getAttribute?.("aria-label"),
        pressed: card.getAttribute?.("aria-pressed"),
        text: card.textContent,
        day: card.closest("[data-day]")?.getAttribute("data-day"),
      })),
      selected: document.querySelector(".pulse-selected")?.textContent,
      stats: document.querySelector(".pulse-stat-numbers")?.textContent,
      date: document
        .querySelector(".pulse-history-range input")
        ?.getAttribute("aria-valuetext"),
    });
  const probe = {
    sample: null,
    tasks: [],
    supportedLongtask:
      PerformanceObserver.supportedEntryTypes.includes("longtask"),
  };
  window.__pulseUiProbe = probe;
  if (probe.supportedLongtask)
    new PerformanceObserver((list) =>
      probe.tasks.push(
        ...list.getEntries().map((e) => ({
          startTime: e.startTime,
          duration: e.duration,
          attribution: e.attribution?.map((a) => ({
            name: a.name,
            containerType: a.containerType,
          })),
        })),
      ),
    ).observe({ type: "longtask", buffered: true });
  document.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest?.(".pulse-mode-toggle")) return;
      const start = performance.now();
      const returning = !!document.querySelector(".pulse-mode");
      const expectedEmpty = probe.expected?.empty === true;
      const expectedSelection = probe.expected?.selection;
      const selectionReady = () =>
        !expectedSelection ||
        (document.querySelector(".pulse-copy h2")?.textContent ===
          expectedSelection.title &&
          JSON.stringify(
            [...document.querySelectorAll(".pulse-stat-numbers strong")].map(
              (element) => element.textContent,
            ),
          ) === JSON.stringify(expectedSelection.stats) &&
          [...document.querySelectorAll(".pulse-album")].some(
            (element) =>
              element.getAttribute("data-album-id") ===
                expectedSelection.albumId &&
              element.getAttribute("aria-pressed") === "true" &&
              element.closest("[data-day]")?.getAttribute("data-day") ===
                expectedSelection.day,
          ));
      const emptyReady = () =>
        document
          .querySelector(".pulse-empty[role='status']")
          ?.textContent?.trim() === "История прослушивания пока пуста" &&
        !document.querySelector(".pulse-rail") &&
        !document.querySelector(".pulse-copy h2") &&
        !document.querySelector(".pulse-stat-numbers");
      if (!returning) {
        probe.panels = [
          ...document.querySelectorAll(".workspace, .workspace *"),
        ]
          .filter(
            (e) =>
              e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight,
          )
          .map((element) => ({
            element,
            left: element.scrollLeft,
            top: element.scrollTop,
          }));
      }
      const sample = {
        start,
        returning,
        expectedEmpty,
        contextAtClick: {
          visible: document.visibilityState !== "hidden",
          focused: document.hasFocus?.() ?? null,
        },
        shellReady: null,
        dataReady: null,
        coversReady: null,
      };
      probe.cancel?.();
      probe.sample = sample;
      let observer;
      let stopDiagnostics = () => {};
      if (diagnostic) {
        sample.phases = {
          visibilityAtClick: document.visibilityState,
          focusAtClick: document.hasFocus(),
          fontsAtClick: document.fonts?.status,
          shellDomObserved: null,
          cardAndStatsDomObserved: null,
          frames: [],
          raf: [],
          rafDropped: 0,
          decodeRaf: [],
          decodeRafDropped: 0,
          contextChanges: [],
          contextChangesDropped: 0,
          paintsAtClick: performance.getEntriesByType("paint").map((entry) => ({
            name: entry.name,
            relativeMs: entry.startTime - start,
          })),
        };
        const observe = () => {
          const pulse = document.querySelector(".pulse-mode");
          if (
            (returning ? !pulse : !!pulse) &&
            sample.phases.shellDomObserved === null
          )
            sample.phases.shellDomObserved = performance.now() - start;
          if (
            !returning &&
            document.querySelector(".pulse-album") &&
            document.querySelector(".pulse-stat-numbers") &&
            sample.phases.cardAndStatsDomObserved === null
          )
            sample.phases.cardAndStatsDomObserved = performance.now() - start;
        };
        observer = new MutationObserver(observe);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        const contextChanged = (event) => {
          if (sample.phases.contextChanges.length >= 64) {
            sample.phases.contextChangesDropped++;
            return;
          }
          sample.phases.contextChanges.push({
            event: event.type,
            relativeMs: performance.now() - start,
            visibility: document.visibilityState,
            focused: document.hasFocus(),
          });
        };
        document.addEventListener("visibilitychange", contextChanged);
        window.addEventListener("focus", contextChanged);
        window.addEventListener("blur", contextChanged);
        stopDiagnostics = () => {
          observer.disconnect();
          document.removeEventListener("visibilitychange", contextChanged);
          window.removeEventListener("focus", contextChanged);
          window.removeEventListener("blur", contextChanged);
        };
        probe.cancel = () => {
          if (sample.coversReady === null)
            sample.phases.cancelledAtMs = performance.now() - start;
          stopDiagnostics();
        };
      }
      // Record the initial two RAFs too: recording only `frame` hides the wait
      // before the very first callback. Diagnostic logging never changes readiness.
      const requestFrame = (purpose, callback) => {
        if (!diagnostic) return requestAnimationFrame(callback);
        const requestedMs = performance.now() - start;
        // Repeated readiness frames must not consume the final decode evidence.
        // Retain the latest bounded decode attempts, including their two RAFs.
        const decodingFrame = purpose.startsWith("decode-");
        const entries = decodingFrame
          ? sample.phases.decodeRaf
          : sample.phases.raf;
        if (decodingFrame && entries.length === 16) {
          entries.shift();
          sample.phases.decodeRafDropped++;
        }
        const entry =
          entries.length < (decodingFrame ? 16 : 180)
            ? {
                purpose,
                requestedMs,
                visibilityAtRequest: document.visibilityState,
                focusedAtRequest: document.hasFocus(),
                firedMs: null,
              }
            : null;
        if (entry) entries.push(entry);
        else sample.phases.rafDropped++;
        return requestAnimationFrame((timestamp) => {
          if (probe.sample !== sample || sample.coversReady !== null) return;
          if (entry) {
            entry.firedMs = performance.now() - start;
            entry.callbackTimestampMs = timestamp - start;
            entry.waitMs = entry.firedMs - requestedMs;
            entry.visibilityAtFire = document.visibilityState;
            entry.focusedAtFire = document.hasFocus();
          }
          callback(timestamp);
        });
      };
      let decoding = false;
      let readyFrames = 0;
      let readyCards = [];
      let readySemantics;
      let readyStats;
      const frame = () => {
        if (probe.sample !== sample || sample.coversReady !== null) return;
        if (diagnostic && sample.phases.frames.length < 180)
          sample.phases.frames.push(performance.now() - start);
        const pulse = document.querySelector(".pulse-mode");
        const shell = returning
          ? !pulse && !!document.querySelector(".workspace")
          : !!pulse;
        if (shell && sample.shellReady === null)
          sample.shellReady = performance.now() - start;
        const cards = [...document.querySelectorAll(".pulse-album")].filter(
          visible,
        );
        const loading = [
          ...document.querySelectorAll(".pulse-card-loading"),
        ].some(visible);
        let ready = false;
        if (document.visibilityState !== "hidden") {
          if (returning)
            ready =
              shell &&
              visible(document.querySelector(".workspace")) &&
              document.activeElement === document.querySelector(".workspace") &&
              (probe.panels ?? []).every(
                ({ element, left, top }) =>
                  element.isConnected &&
                  element.scrollLeft === left &&
                  element.scrollTop === top,
              );
          else if (expectedEmpty) ready = shell && emptyReady();
          else
            ready =
              shell &&
              !!document.querySelector(".pulse-rail") &&
              cards.length > 0 &&
              !loading &&
              !!document.querySelector(".pulse-stat-numbers") &&
              selectionReady();
        }
        const sameCards =
          cards.length === readyCards.length &&
          cards.every((card, i) => card === readyCards[i]);
        const currentSemantics = semantics(cards);
        const statsNode = document.querySelector(".pulse-stat-numbers");
        const same =
          sameCards &&
          readySemantics === currentSemantics &&
          readyStats === statsNode;
        if (!ready || !same) sample.dataReady = null;
        readyFrames = ready ? (same ? readyFrames + 1 : 1) : 0;
        readyCards = cards;
        readySemantics = currentSemantics;
        readyStats = statsNode;
        // The detecting RAF precedes paint. Two subsequent RAFs, relative to
        // readiness (not the click), provide a rendering opportunity.
        if (readyFrames >= 3 && sample.dataReady === null)
          sample.dataReady = performance.now() - start;
        if (readyFrames >= 3 && !decoding) {
          decoding = true;
          const images = [
            ...document.querySelectorAll(".pulse-mode img"),
          ].filter(visible);
          const sources = images.map((img) => img.currentSrc);
          Promise.all(
            images.map(async (img) => {
              try {
                await img.decode();
                return { src: img.currentSrc, status: "decoded" };
              } catch {
                return {
                  src: img.currentSrc,
                  status: "error",
                  complete: img.complete,
                };
              }
            }),
          ).then((covers) =>
            requestFrame("decode-opportunity-1", () =>
              requestFrame("decode-opportunity-2", () => {
                if (probe.sample !== sample) return;
                const currentCards = [
                  ...document.querySelectorAll(".pulse-album"),
                ].filter(visible);
                if (
                  readyFrames < 3 ||
                  currentCards.length !== cards.length ||
                  currentCards.some((card, i) => card !== cards[i]) ||
                  semantics(currentCards) !== currentSemantics ||
                  document.querySelector(".pulse-stat-numbers") !== statsNode ||
                  [...document.querySelectorAll(".pulse-card-loading")].some(
                    visible,
                  ) ||
                  images.some(
                    (img, i) =>
                      !img.isConnected ||
                      !visible(img) ||
                      img.currentSrc !== sources[i],
                  ) ||
                  document.visibilityState === "hidden" ||
                  (returning
                    ? !!document.querySelector(".pulse-mode")
                    : expectedEmpty
                      ? !emptyReady()
                      : !document.querySelector(".pulse-stat-numbers") ||
                        !selectionReady())
                ) {
                  decoding = false;
                  return;
                }
                sample.covers = covers;
                sample.missingCovers =
                  document.querySelectorAll(".pulse-missing").length;
                sample.coversReady = performance.now() - start;
                sample.contextAtReady = {
                  visible: document.visibilityState !== "hidden",
                  focused: document.hasFocus?.() ?? null,
                };
                if (diagnostic) {
                  stopDiagnostics();
                  sample.phases.resources = performance
                    .getEntriesByType("resource")
                    .filter((entry) => entry.responseEnd >= start)
                    .map((entry) => ({
                      path: new URL(entry.name).pathname,
                      startMs: entry.startTime - start,
                      responseEndMs: entry.responseEnd - start,
                      durationMs: entry.duration,
                    }));
                  sample.phases.visibilityAtReady = document.visibilityState;
                  sample.phases.focusAtReady = document.hasFocus();
                  sample.phases.paintsAtReady = performance
                    .getEntriesByType("paint")
                    .map((entry) => ({
                      name: entry.name,
                      relativeMs: entry.startTime - start,
                    }));
                }
                sample.dom = {
                  days: document.querySelectorAll(".pulse-day").length,
                  cards: document.querySelectorAll(".pulse-album").length,
                  images: document.querySelectorAll(".pulse-mode img").length,
                  nodes: document.querySelectorAll("*").length,
                };
              }),
            ),
          );
        }
        if (sample.coversReady === null) requestFrame("readiness", frame);
      };
      // Double RAF: readiness is observed after at least one rendering opportunity,
      // not a visibility assertion or a hardware presentation timestamp.
      requestFrame("initial-opportunity-1", () =>
        requestFrame("initial-opportunity-2", frame),
      );
    },
    true,
  );
}

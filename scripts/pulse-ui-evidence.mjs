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
      return [
        key,
        {
          shellReady: distribution(values.map((value) => value.shellReady)),
          dataReady: ready,
          coversReady: distribution(values.map((value) => value.coversReady)),
          diagnosticP95WithinGuide: ready.p95Ms < (cold ? 300 : 100),
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
export function installUiProbe() {
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
        shellReady: null,
        dataReady: null,
        coversReady: null,
      };
      probe.sample = sample;
      let decoding = false;
      let readyFrames = 0;
      let readyCards = [];
      const frame = () => {
        if (probe.sample !== sample) return;
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
        const ready = returning
          ? shell &&
            visible(document.querySelector(".workspace")) &&
            document.activeElement === document.querySelector(".workspace") &&
            (probe.panels ?? []).every(
              ({ element, left, top }) =>
                element.isConnected &&
                element.scrollLeft === left &&
                element.scrollTop === top,
            )
          : shell &&
            !!document.querySelector(".pulse-rail") &&
            cards.length > 0 &&
            !loading &&
            !!document.querySelector(".pulse-stat-numbers");
        const sameCards =
          cards.length === readyCards.length &&
          cards.every((card, i) => card === readyCards[i]);
        readyFrames = ready ? (sameCards ? readyFrames + 1 : 1) : 0;
        readyCards = cards;
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
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (probe.sample !== sample) return;
                const currentCards = [
                  ...document.querySelectorAll(".pulse-album"),
                ].filter(visible);
                if (
                  readyFrames < 3 ||
                  currentCards.length !== cards.length ||
                  currentCards.some((card, i) => card !== cards[i]) ||
                  [...document.querySelectorAll(".pulse-card-loading")].some(
                    visible,
                  ) ||
                  images.some(
                    (img, i) =>
                      !img.isConnected ||
                      !visible(img) ||
                      img.currentSrc !== sources[i],
                  ) ||
                  (returning
                    ? !!document.querySelector(".pulse-mode")
                    : !document.querySelector(".pulse-stat-numbers"))
                ) {
                  decoding = false;
                  return;
                }
                sample.covers = covers;
                sample.missingCovers =
                  document.querySelectorAll(".pulse-missing").length;
                sample.coversReady = performance.now() - start;
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
        if (sample.coversReady === null) requestAnimationFrame(frame);
      };
      // Double RAF: readiness is observed after at least one rendering opportunity,
      // not a visibility assertion or a hardware presentation timestamp.
      requestAnimationFrame(() => requestAnimationFrame(frame));
    },
    true,
  );
}

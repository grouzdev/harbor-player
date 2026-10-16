import assert from "node:assert/strict";

export function memoryFailureStatus(error, observation) {
  const message = String(error?.message ?? error);
  const presentationWait =
    message.startsWith("Timeout:") ||
    message.startsWith("Main inspector Runtime.evaluate timeout") ||
    message.includes("Native foreground required");
  const unavailable =
    observation &&
    (observation.visible === false ||
      observation.focused === false ||
      observation.renderer?.visibility === "hidden");
  return presentationWait && unavailable ? "INCONCLUSIVE" : "FAILED";
}

export function durationSeconds(values) {
  const seconds = Number(
    values["duration-seconds"] ?? (values.smoke ? 10 : 1800),
  );
  assert(
    Number.isFinite(seconds) && seconds > 0,
    "duration must be positive seconds",
  );
  return seconds;
}

export function memoryDatasets(dataset = "all") {
  assert(
    ["all", "ordinary", "ten-year"].includes(dataset),
    "dataset must be all, ordinary or ten-year",
  );
  return dataset === "all" ? ["ordinary", "ten-year"] : [dataset];
}

export function navigationTargets(manifest) {
  const last = Math.round(
    (Date.parse(manifest.to) - Date.parse(manifest.from)) / 86400000,
  );
  assert(last >= 0);
  return [
    ...new Set([
      0,
      ...Array.from(
        { length: Math.floor(last / 365) },
        (_, i) => (i + 1) * 365,
      ),
      last,
    ]),
  ];
}

export function checkPoint(point, manifest, offset) {
  const expected = new Date(Date.parse(manifest.from) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
  assert.equal(point.date, expected, "Actual range date");
  assert(point.settled, "Target day must be loaded");
  const bound = Math.ceil(point.viewport / 64) + 8;
  assert(point.days <= bound, "Day DOM exceeds viewport envelope");
  assert(point.cards <= bound * 4 + 32, "Album DOM exceeds viewport envelope");
  assert(
    point.titles.every((title) => title.includes(manifest.sentinel)),
    "Fixture sentinel",
  );
  assert.equal(
    point.titles.length > 0,
    offset % 3 === 0 || expected === manifest.to,
  );
  return expected;
}

// Deliberately no generic CDP escape hatch: the cohort has no renderer debugger.
export async function connectMainInspector(port) {
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000),
    })
  ).json();
  assert.equal(targets.length, 1, "Expected one owned main inspector target");
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Main inspector open timeout"));
    }, 10000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Main inspector socket error"));
      },
      { once: true },
    );
  });
  let sequence = 0;
  return {
    close: () => socket.close(),
    evaluate(expression) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const finish = (error, value) => {
          clearTimeout(timer);
          socket.removeEventListener("message", listener);
          error ? reject(error) : resolve(value);
        };
        const listener = ({ data }) => {
          const reply = JSON.parse(data);
          if (reply.id !== id) return;
          if (reply.error || reply.result?.exceptionDetails)
            finish(new Error(JSON.stringify(reply)));
          else finish(null, reply.result.result.value);
        };
        const timer = setTimeout(
          () => finish(new Error("Main inspector Runtime.evaluate timeout")),
          15000,
        );
        socket.addEventListener("message", listener);
        socket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    },
  };
}

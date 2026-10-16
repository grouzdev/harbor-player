// Uninstrumented renderer cohort. No Playwright, renderer CDP, Network domain,
// forced GC, fake clocks, handler replacement, or power-policy changes.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  checkPoint,
  connectMainInspector,
  durationSeconds,
  memoryDatasets,
  memoryFailureStatus,
  navigationTargets,
} from "./pulse-memory-evidence.mjs";

const { values } = parseArgs({
  options: {
    smoke: { type: "boolean", default: false },
    "duration-seconds": { type: "string" },
    dataset: { type: "string", default: "all" },
  },
});
assert.equal(process.platform, "win32", "Native Windows packaged cohort only");
const duration = durationSeconds(values);
const datasets = memoryDatasets(values.dataset);
await mkdir(".test-data", { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-p1-ui-memory-"));
const executable = path.resolve(
  process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE ||
    "release/win-unpacked/Harbor Player.exe",
);
const evidence = {
  root,
  executable,
  durationSeconds: duration,
  smoke: values.smoke,
  datasets,
  scope: "Completion flags apply only to the explicitly selected datasets",
  longAcceptance: false,
  status: "RUNNING",
  protocol:
    "main Node inspector only; renderer debugger never attached; no Network.enable; no forced GC",
  memoryUnits:
    "app.getAppMetrics memory workingSetSize/peakWorkingSetSize/privateBytes are KiB",
  limitations: [
    "No actual-image/GPU/manual acceptance",
    "No owned heap capture: would perturb the unforced memory cohort",
    "Intermediate targets use the native range setter plus native keyboard commit, as in the network profile",
    "Memory trend is evidence, not a product leak verdict",
  ],
  runs: [],
};
const save = () =>
  writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
console.log(`Memory artifacts: ${root}`);
let child, inspector;
async function until(read, label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (child?.spawnError) throw child.spawnError;
    assert(
      !child || (child.exitCode === null && child.signalCode === null),
      "Owned Electron exited",
    );
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return [4317, 4327].includes(port) ? freePort() : port;
}
async function stop() {
  inspector?.close();
  inspector = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    const deadline = Date.now() + 10000;
    while (
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    )
      await delay(100);
    assert(
      child.exitCode !== null || child.signalCode !== null,
      "Owned process cleanup unconfirmed",
    );
  }
  child = undefined;
}
process.once("SIGINT", () => {
  void stop().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(143));
});
try {
  const hash = async (file) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  evidence.provenance = {
    executableSha256: await hash(executable),
    appAsarSha256: await hash(
      path.join(path.dirname(executable), "resources/app.asar"),
    ),
    packagedVersion: (
      await readFile(path.join(path.dirname(executable), "version"), "utf8")
    ).trim(),
    node: process.version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  };
  const fixtureModule =
    process.env.HARBOR_PLAYER_MEMORY_FIXTURE_MODULE ||
    new URL("./pulse-ui-dataset.mjs", import.meta.url).href;
  evidence.fixtureModule = fixtureModule;
  const { seedUiDataset } = await import(fixtureModule);
  for (const dataset of datasets) {
    const data = path.join(root, dataset, "data");
    const manifest = await seedUiDataset(data, dataset);
    const port = await freePort(),
      mainPort = await freePort();
    const run = {
      dataset,
      data,
      manifest,
      port,
      mainPort,
      samples: [],
      points: [],
      output: "",
    };
    evidence.runs.push(run);
    child = spawn(
      executable,
      [
        `--inspect=127.0.0.1:${mainPort}`,
        `--user-data-dir=${path.join(data, "electron")}`,
      ],
      {
        env: {
          ...process.env,
          HARBOR_PLAYER_DEV: "0",
          HARBOR_PLAYER_DATA_DIR: data,
          HARBOR_PLAYER_PORT: String(port),
          HARBOR_PLAYER_NO_OPEN: "1",
          HARBOR_PLAYER_PULSE_BENCHMARK: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    run.pid = child.pid;
    child.once("error", (error) => {
      child.spawnError = error;
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        run.output += chunk;
      });
    inspector = await until(async () => {
      try {
        return await connectMainInspector(mainPort);
      } catch {
        return null;
      }
    }, "main Node inspector endpoint (no renderer fallback)");
    await until(
      () =>
        inspector.evaluate(`(() => {
      const {BrowserWindow} = process.getBuiltinModule("module").createRequire(process.execPath)("electron");
      return BrowserWindow.getAllWindows().length === 1;
    })()`),
      "owned BrowserWindow",
    );
    run.nativeBefore = await inspector.evaluate(`(() => {
      const {app,BrowserWindow} = process.getBuiltinModule("module").createRequire(process.execPath)("electron");
      globalThis.__pulseMemoryApp = app;
      globalThis.__pulseMemoryWindow = BrowserWindow.getAllWindows()[0];
      const w = __pulseMemoryWindow;
      return {pid:process.pid,execPath:process.execPath,versions:process.versions,version:app.getVersion(),
        userData:app.getPath("userData"),sessionData:app.getPath("sessionData"),
        url:w.webContents.getURL(),preferences:w.webContents.getLastWebPreferences()};
    })()`);
    assert.equal(run.nativeBefore.pid, child.pid);
    assert.equal(
      path.resolve(run.nativeBefore.userData),
      path.join(data, "electron"),
    );
    assert.equal(
      path.resolve(run.nativeBefore.sessionData),
      path.join(data, "electron", "session"),
    );
    await until(
      () =>
        inspector.evaluate(
          `__pulseMemoryWindow.isVisible() && !__pulseMemoryWindow.isMinimized()`,
        ),
      "normal native window show",
    );
    await inspector.evaluate("__pulseMemoryWindow.focus(); true");
    const renderer = (expression) =>
      inspector.evaluate(
        `__pulseMemoryWindow.webContents.executeJavaScript(${JSON.stringify(expression)}, true)`,
      );
    const input = (event) =>
      inspector.evaluate(
        `__pulseMemoryWindow.webContents.sendInputEvent(${JSON.stringify(event)}); true`,
      );
    const key = async (keyCode) => {
      await input({ type: "keyDown", keyCode });
      await input({ type: "keyUp", keyCode });
    };
    await until(
      () =>
        renderer(
          `location.origin === "http://127.0.0.1:${port}" &&
          !!document.querySelector(".pulse-mode-toggle") &&
          document.querySelector(".workspace")?.getAttribute("aria-busy") === "false" &&
          document.fonts.status === "loaded" && document.hasFocus() &&
          document.visibilityState === "visible"`,
        ),
      "isolated UI",
    );
    await renderer(`new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const box = await renderer(
      `(() => { const r=document.querySelector(".pulse-mode-toggle").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`,
    );
    await input({ type: "mouseDown", ...box, button: "left", clickCount: 1 });
    await input({ type: "mouseUp", ...box, button: "left", clickCount: 1 });
    await until(
      () => renderer(`!!document.querySelector(".pulse-history-range input")`),
      "Pulse controls",
    );
    const sample = async (phase) => {
      const value =
        await inspector.evaluate(`({wall:Date.now(),metrics:__pulseMemoryApp.getAppMetrics(),
        focused:__pulseMemoryWindow.isFocused(),visible:__pulseMemoryWindow.isVisible(),
        minimized:__pulseMemoryWindow.isMinimized(),url:__pulseMemoryWindow.webContents.getURL(),
        rendererPid:__pulseMemoryWindow.webContents.getOSProcessId(),
        debuggerAttached:__pulseMemoryWindow.webContents.debugger.isAttached()})`);
      run.samples.push({ phase, ...value });
      if (phase === "before" || phase === "end" || phase === "idle")
        await writeFile(
          path.join(root, dataset, `${phase}.json`),
          JSON.stringify(value, null, 2),
        );
      await save();
      assert(
        value.focused && value.visible && !value.minimized,
        "Native foreground required",
      );
      assert.equal(
        value.debuggerAttached,
        false,
        "Renderer debugger must remain unattached",
      );
    };
    await sample("before");
    const started = Date.now();
    let nextSample = started + 15000;
    let nextProgress = started;
    do {
      for (const offset of navigationTargets(manifest)) {
        await renderer(
          `document.querySelector(".pulse-history-range input").focus(); true`,
        );
        if (offset === 0) await key("Home");
        const last = navigationTargets(manifest).at(-1);
        if (offset === last) await key("End");
        else if (offset !== 0) {
          await renderer(`(() => {
            const input=document.querySelector(".pulse-history-range input");
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${offset});
            input.dispatchEvent(new Event("input",{bubbles:true}));
            input.dispatchEvent(new Event("change",{bubbles:true}));
            return true;
          })()`);
          await key("Right");
          await until(
            () =>
              renderer(
                `Number(document.querySelector(".pulse-history-range input").value) === ${offset + 1}`,
              ),
            "range keyboard commit",
          );
          await key("Left");
        }
        const expected = new Date(Date.parse(manifest.from) + offset * 86400000)
          .toISOString()
          .slice(0, 10);
        run.pendingTarget = { offset, expected };
        const point = await until(
          () =>
            renderer(`(() => {
          const input=document.querySelector(".pulse-history-range input");
          const day=document.querySelector('.pulse-day[data-day="${expected}"]');
          if(input?.getAttribute("aria-valuetext") !== "${expected}" || !day || day.querySelector(".pulse-card-loading")) return null;
          if ((day.querySelectorAll(".pulse-album").length > 0) !== ${offset % 3 === 0 || expected === manifest.to}) return null;
          return {date:input.getAttribute("aria-valuetext"),settled:true,days:document.querySelectorAll(".pulse-day").length,
            cards:document.querySelectorAll(".pulse-album").length,viewport:document.querySelector(".pulse-rail").clientWidth,
            titles:[...day.querySelectorAll(".pulse-album")].map(x=>x.getAttribute("aria-label")||"")};
        })()`),
          `settled reached ${expected}`,
        );
        checkPoint(point, manifest, offset);
        delete run.pendingTarget;
        run.points.push({ wall: Date.now(), ...point });
        await delay(250);
        if (Date.now() >= nextSample) {
          await sample("periodic");
          nextSample = Date.now() + 15000;
        }
        if (Date.now() >= nextProgress) {
          console.log(
            `Memory ${dataset}: ${Math.round((Date.now() - started) / 1000)}s, ${run.points.length} settled targets`,
          );
          nextProgress = Date.now() + 60000;
        }
      }
    } while (Date.now() - started < duration * 1000);
    const rail = await renderer(`(() => {
      const r=document.querySelector(".pulse-rail").getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()`);
    await input({ type: "mouseWheel", ...rail, deltaX: -720, deltaY: 0 });
    await input({ type: "mouseDown", ...rail, button: "left", clickCount: 1 });
    for (let step = 1; step <= 6; step++)
      await input({
        type: "mouseMove",
        x: rail.x - step * 20,
        y: rail.y,
        button: "left",
      });
    await input({
      type: "mouseUp",
      x: rail.x - 120,
      y: rail.y,
      button: "left",
      clickCount: 1,
    });
    await delay(250);
    run.elapsedMs = Date.now() - started;
    await sample("end");
    await delay(values.smoke ? 250 : 10000);
    await sample("idle");
    run.completed = true;
    await stop();
  }
  evidence.completed = true;
  evidence.status = "COMPLETED";
  evidence.longDurationCompleted = !values.smoke && duration >= 1800;
} catch (error) {
  evidence.error = error.stack || String(error);
  if (inspector) {
    try {
      evidence.failureObservation = await inspector.evaluate(`(async () => ({
        visible:__pulseMemoryWindow.isVisible(),
        focused:__pulseMemoryWindow.isFocused(),
        renderer:await __pulseMemoryWindow.webContents.executeJavaScript(\`({
          date:document.querySelector(".pulse-history-range input")?.getAttribute("aria-valuetext"),
          value:document.querySelector(".pulse-history-range input")?.value,
          pulseToggle:document.querySelector(".pulse-mode-toggle")?.getAttribute("aria-pressed"),
          pulseText:document.querySelector(".pulse-mode")?.textContent,
          loading:document.querySelectorAll(".pulse-card-loading").length,
          visibility:document.visibilityState
        })\`, true)
      }))()`);
    } catch {
      evidence.failureObservation = "Owned inspector unavailable";
    }
  }
  evidence.status = memoryFailureStatus(error, evidence.failureObservation);
  process.exitCode = 1;
} finally {
  await stop();
  await save();
  console.log(
    JSON.stringify(
      {
        root,
        completed: evidence.completed || false,
        status: evidence.status,
        longAcceptance: evidence.longAcceptance,
        error: evidence.error,
      },
      null,
      2,
    ),
  );
}

// Explicit foreground opt-in; no build, playback, forced GC or leak verdict.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { inspectPermittedArtwork } from "./pulse-artwork-fixture.mjs";
import { connectMainInspector } from "./pulse-memory-evidence.mjs";
import { parseArtworkMemoryTrace } from "./pulse-artwork-diagnostic-evidence.mjs";

const { values } = parseArgs({
  options: {
    foreground: { type: "boolean", default: false },
    manifest: {
      type: "string",
      default: ".test-data/pulse-permitted-originals/manifest.json",
    },
    executable: { type: "string" },
  },
});
assert.equal(
  process.platform,
  "win32",
  "Windows diagnostic and owned-tree cleanup only",
);
assert(
  values.foreground,
  "Pass --foreground only with explicit window authorization",
);
const preflight = await inspectPermittedArtwork(values.manifest, {
  retainedCopies: 1,
});
assert(
  preflight.fileCount > 0 && preflight.fileCount <= 12,
  "Bounded diagnostic requires 1–12 permitted originals",
);
await mkdir(".test-data", { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-p1-ui-artwork-"));
const data = path.join(root, "data");
const profile = path.join(data, "electron");
const require = createRequire(import.meta.url);
const executable = path.resolve(values.executable ?? require("electron"));
const evidence = {
  version: 1,
  status: "RUNNING",
  preflight,
  scope:
    "Aggregate UI fixture with permitted originals, NOT actual playback/recorder evidence. Diagnostic overlay in real workspace UI; not product Pulse card rendering.",
  instrumentation:
    "Main inspector + renderer executeJavaScript + global CDP memory-infra detailed dumps; intrusive diagnostic cohort, no forced GC.",
  memoryUnits:
    "Full app.getAppMetrics memory fields are native KiB. GPU process working set is NOT VRAM. No GPU thresholds or leak claims.",
  phases: [],
};
const save = () =>
  writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
let child, inspector;
let stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    inspector?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      else child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        delay(5000),
      ]);
      assert(
        child.exitCode !== null || child.signalCode !== null,
        "Owned cleanup unconfirmed",
      );
    }
  })();
  return stopping;
}
const deadline = setTimeout(() => {
  evidence.status = "TIMEOUT";
  void stop()
    .finally(() => save())
    .finally(() => process.exit(1));
}, 175000);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void stop().finally(() => process.exit(1));
  });
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(read) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    assert(
      !child?.spawnError && child?.exitCode === null,
      "Owned Electron unavailable",
    );
    const result = await read();
    if (result) return result;
    await delay(200);
  }
  throw new Error("Readiness deadline exceeded");
}
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
async function artifactHashes(directory) {
  const hashes = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await artifactHashes(file));
    else if (entry.isFile()) hashes[file] = await hash(file);
  }
  return hashes;
}
try {
  evidence.identity = {
    executableSha256: await hash(executable),
    manifestSha256: await hash(values.manifest),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
    nodeVersion: process.version,
    sourceHashes: Object.fromEntries(
      await Promise.all(
        [
          "scripts/pulse-artwork-diagnostic.mjs",
          "scripts/pulse-artwork-diagnostic-evidence.mjs",
          "scripts/pulse-artwork-fixture.mjs",
          "scripts/pulse-ui-dataset.mjs",
          "package-lock.json",
        ].map(async (file) => [file, await hash(file)]),
      ),
    ),
    distHashes: await artifactHashes("dist"),
  };
  if (values.executable)
    evidence.identity.appAsarSha256 = await hash(
      path.join(path.dirname(executable), "resources/app.asar"),
    );
  else
    evidence.identity.workspaceMainSha256 = await hash("dist/desktop/main.js");
  // Existing manifest format/helper, in its explicitly allowed disposable root.
  process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST = path.resolve(values.manifest);
  const { seedUiDataset } = await import("./pulse-ui-dataset.mjs");
  const fixture = await seedUiDataset(data, "ordinary", { retainedCopies: 1 });
  const files = fixture.covers.artwork.files;
  evidence.originals = files;
  const mainPort = await freePort(),
    port = await freePort();
  const env = {
    ...process.env,
    HARBOR_PLAYER_DEV: "0",
    HARBOR_PLAYER_DATA_DIR: data,
    HARBOR_PLAYER_PORT: String(port),
    HARBOR_PLAYER_NO_OPEN: "1",
    HARBOR_PLAYER_PULSE_BENCHMARK: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(
    executable,
    [
      `--inspect=127.0.0.1:${mainPort}`,
      `--user-data-dir=${profile}`,
      ...(values.executable ? [] : ["."]),
    ],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-1048576);
    });
  child.once("exit", (code, signal) => {
    evidence.exit = { code, signal };
    void writeFile(path.join(root, "electron.log"), output);
  });
  child.once("error", (error) => {
    child.spawnError = error;
  });
  inspector = await until(async () => {
    try {
      return await connectMainInspector(mainPort);
    } catch {
      return null;
    }
  });
  const evaluate = (expression) => inspector.evaluate(expression);
  await until(() =>
    evaluate(`(() => {
    globalThis.__artElectron = process.getBuiltinModule("module").createRequire(process.execPath)("electron");
    globalThis.__artWindow = __artElectron.BrowserWindow.getAllWindows()[0];
    return !!__artWindow && !__artWindow.webContents.isLoading() &&
      __artWindow.webContents.getURL() === "http://127.0.0.1:${port}/";
  })()`),
  );
  const identity = await evaluate(`({pid:process.pid,versions:process.versions,
    profile:__artElectron.app.getPath("userData"),
    session:__artElectron.app.getPath("sessionData")})`);
  assert.equal(identity.pid, child.pid);
  assert.equal(path.resolve(identity.profile), profile);
  assert.equal(path.resolve(identity.session), path.join(profile, "session"));
  evidence.identity.versions = identity.versions;
  await evaluate("__artWindow.show(); __artWindow.focus(); true");
  const renderer = (expression) =>
    evaluate(
      `__artWindow.webContents.executeJavaScript(${JSON.stringify(expression)},true)`,
    );
  async function sample(phase) {
    const native = await evaluate(`(async () => ({
      metrics:__artElectron.app.getAppMetrics(),
      gpuFeatures:__artElectron.app.getGPUFeatureStatus(),
      gpuInfo:await __artElectron.app.getGPUInfo("complete"),
      visible:__artWindow.isVisible(),focused:__artWindow.isFocused(),
      minimized:__artWindow.isMinimized()
    }))()`);
    assert(
      native.visible && native.focused && !native.minimized,
      "Foreground window required",
    );
    const point = { phase, native, allocator: { status: "NOT MEASURED" } };
    point.windowsGpuProcessMemory = { status: "NOT MEASURED" };
    if (process.platform === "win32") {
      try {
        const pids = native.metrics.map((metric) => metric.pid);
        assert(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
        const output = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$ErrorActionPreference='Stop'; $ids=@(${pids.join(",")}); $rows=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and $ids -contains [int]$Matches[1] } | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted); ConvertTo-Json -InputObject $rows -Compress`,
          ],
          {
            encoding: "utf8",
            timeout: 8000,
            maxBuffer: 1048576,
            windowsHide: true,
          },
        );
        const rows = JSON.parse(output);
        point.windowsGpuProcessMemory = {
          status: rows.length ? "MEASURED" : "NOT MEASURED",
          units: "bytes",
          rows,
          note: "Owned metric PIDs only; per-process/adapter rows retained without summation. Shared/committed usage is not dedicated VRAM.",
        };
      } catch {
        /* Unsupported counters are not zero. */
      }
    }
    evidence.phases.push(point);
    try {
      const file = path.join(root, `${phase}-trace.json`);
      point.dump = await evaluate(`(async () => {
        const d=__artWindow.webContents.debugger;
        if(!d.isAttached()) d.attach("1.3");
        await d.sendCommand("Tracing.start",{categories:"disabled-by-default-memory-infra",
          options:"record-until-full",transferMode:"ReturnAsStream"});
        const dump=await d.sendCommand("Tracing.requestMemoryDump",{levelOfDetail:"detailed"});
        let listener;
        const completed=new Promise(resolve=>{
          listener=(_e,method,params)=>{
            if(method==="Tracing.tracingComplete"){d.off("message",listener);resolve(params);}
          }; d.on("message",listener);
        });
        let stream;
        try {
        await d.sendCommand("Tracing.end");
        const result=await completed;
        stream=result.stream;
        const {dataLossOccurred}=result;
        if(dataLossOccurred) {
          if(stream) await d.sendCommand("IO.close",{handle:stream});
          throw Error("Memory trace data loss");
        }
        let text="";
        try {
          for(;;){
            const part=await d.sendCommand("IO.read",{handle:stream,size:1048576});
            text+=part.base64Encoded?Buffer.from(part.data,"base64").toString("utf8"):part.data;
            if(Buffer.byteLength(text)>67108864) throw Error("Trace exceeds 64 MiB");
            if(part.eof) break;
          }
        } finally {await d.sendCommand("IO.close",{handle:stream});}
        process.getBuiltinModule("fs").writeFileSync(${JSON.stringify(file)},text);
        return {...dump,dataLossOccurred:!!dataLossOccurred};
        } finally {
          d.off("message",listener);
          if(d.isAttached()) d.detach();
        }
      })()`);
      assert.equal(point.dump.success, true, "Detailed memory dump failed");
      point.allocator = parseArtworkMemoryTrace(
        JSON.parse(await readFile(file, "utf8")),
      );
    } catch (error) {
      await writeFile(
        path.join(root, `${phase}-trace-error.txt`),
        String(error),
      );
      point.allocator = {
        status: "NOT MEASURED",
        reason: "Detailed memory-infra dump unavailable or exceeded budget",
      };
      // Runtime.evaluate timeout does not cancel its remote expression. Stop
      // the owned tree instead of continuing with a possibly active tracer.
      throw error;
    }
    await save();
  }
  await sample("before");
  await renderer(`(() => {
    const panel=document.createElement("section");
    panel.id="pulse-artwork-diagnostic";
    panel.style.cssText="position:fixed;inset:20px;z-index:2147483647;background:#eee;color:#111;overflow:auto;padding:20px";
    panel.textContent="Diagnostic permitted originals — aggregate fixture, NOT playback evidence";
    document.body.append(panel);
    return true;
  })()`);
  evidence.browser = [];
  for (const file of files) {
    const result = await renderer(`(async () => {
    const panel=document.querySelector("#pulse-artwork-diagnostic");
    const results=[];
    for(const file of ${JSON.stringify([{ id: file.id, bytes: file.bytes, format: file.format }])}){
      const url="/api/covers/"+encodeURIComponent(file.id);
      const start=performance.now();
      try {
        const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000)});
        const headersAt=performance.now();
        if(!response.ok) throw Error("HTTP "+response.status);
        const blob=await response.blob();
        const bodyAt=performance.now();
        const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
        const sha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
        const mime=response.headers.get("content-type")?.split(";")[0];
        const transferVerified=blob.size===file.bytes && sha256===file.id.split(".")[0] &&
          mime===(file.format==="jpeg"?"image/jpeg":"image/png");
        if(!transferVerified) throw Error("Original transfer identity mismatch");
        const entry=performance.getEntriesByName(new URL(url,location.href).href).at(-1);
        const img=new Image(); img.style.cssText="width:160px;height:160px;object-fit:contain;margin:8px";
        const objectUrl=URL.createObjectURL(blob); img.src=objectUrl;
        const decodeStart=performance.now();
        let decoded=true;
        try { await img.decode(); } catch { decoded=false; }
        const decodeMs=performance.now()-decodeStart;
        panel.append(img);
        results.push({id:file.id,status:response.status,bodyBytes:blob.size,sha256,mime,transferVerified,
          headersMs:headersAt-start,bodyTransferMs:bodyAt-headersAt,fetchTotalMs:bodyAt-start,
          resourceTiming:entry?{transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize,
            decodedBodySize:entry.decodedBodySize,duration:entry.duration}:null,
          decodeStatus:decoded?"decoded":"failed",decodeMs,width:img.naturalWidth,height:img.naturalHeight});
        // The image retains its decoded resource; release the blob URL mapping.
        URL.revokeObjectURL(objectUrl);
      } catch {results.push({id:file.id,status:"failed"});}
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return results;
  })()`);
    evidence.browser.push(...result);
    await save();
  }
  await sample("decoded");
  await renderer(
    `document.querySelector("#pulse-artwork-diagnostic").remove(); true`,
  );
  await delay(10000);
  await sample("idle");
  evidence.components = {
    transfer: evidence.browser.every((x) => x.transferVerified)
      ? "MEASURED"
      : "NOT MEASURED",
    decode: evidence.browser.every((x) => x.decodeStatus === "decoded")
      ? "MEASURED"
      : "NOT MEASURED",
    native: evidence.phases.length === 3 ? "MEASURED" : "NOT MEASURED",
    allocator: evidence.phases.every((p) => p.allocator.status === "MEASURED")
      ? "MEASURED"
      : "NOT MEASURED",
    windowsGpu: evidence.phases.every(
      (p) => p.windowsGpuProcessMemory.status === "MEASURED",
    )
      ? "MEASURED"
      : "NOT MEASURED",
  };
  evidence.status = Object.values(evidence.components).every(
    (status) => status === "MEASURED",
  )
    ? "COMPLETED"
    : "PARTIAL";
} catch (error) {
  // Local traces may include paths; portable evidence deliberately does not.
  await writeFile(path.join(root, "failure.txt"), error.stack || String(error));
  evidence.status = "FAILED";
  evidence.error =
    "Diagnostic failed; inspect local prerequisites/foreground state. No private exception paths exported.";
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } finally {
    clearTimeout(deadline);
    await save();
  }
  console.log(
    `Artwork diagnostic ${evidence.status}; local artifacts: ${root}`,
  );
}

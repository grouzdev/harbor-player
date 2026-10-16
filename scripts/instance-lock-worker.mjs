import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const [dataDir, gate] = process.argv.slice(2);
if (gate === "before-marker" || gate === "partial-marker") {
  const original = fs.writeFileSync;
  fs.writeFileSync = function (file, data, options) {
    if (String(file).endsWith("server.lock")) {
      if (gate === "partial-marker") original(file, "{", options);
      process.send({ event: "marker-barrier" });
      for (;;)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    return original(file, data, options);
  };
  syncBuiltinESMExports();
}
// Pause the actual old implementation after it has read a stale PID, before
// unlink. Both contenders therefore act on exactly the same stale generation.
if (gate && !gate.endsWith("marker")) {
  const original = process.kill;
  process.kill = function (pid, signal) {
    if (pid !== 2147483647) return original.call(process, pid, signal);
    process.send({ event: "stale" });
    while (!fs.existsSync(gate))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    throw Object.assign(new Error("dead fixture owner"), { code: "ESRCH" });
  };
  syncBuiltinESMExports();
}
const { acquireInstanceLock } = await import("../dist/server/instance-lock.js");
if (gate === "start") {
  process.send({ event: "ready" });
  await new Promise((resolve) => process.once("message", resolve));
}
let release;
process.on("message", (message) => {
  if (message === "release") {
    release?.();
    release?.();
    process.send({ event: "released" });
  }
});
try {
  release = acquireInstanceLock(dataDir);
  process.send({ event: "owned" });
} catch (error) {
  process.send({ event: "denied", message: error.message });
}

// Dedicated child only: replace the copy adapter with a real, paused chunked
// copy. SIGKILL interrupts an open, partially written staging image, not a
// simulated exception. Production publication/transaction/lock code is unmodified.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const [root, mode, coverId, cycle = "0"] = process.argv.slice(2);
if (!process.send || !root || !["copy", "restart"].includes(mode))
  throw new Error("Run via pulse-publication-crash-check.mjs");

if (mode === "copy") {
  fs.promises.copyFile = async (source, destination) => {
    const input = await fs.promises.open(source, "r");
    const output = await fs.promises.open(destination, "wx");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await input.read(buffer, 0, buffer.length, 0);
    await output.writeFile(buffer.subarray(0, bytesRead));
    await output.sync();
    process.send({ type: "partial", destination, bytes: bytesRead });
    // Deliberately leave both handles open until the parent kills this process.
    await new Promise(() => {});
  };
  syncBuiltinESMExports();
}

const { MusicService } = await import("../dist/server/service.js");
const service = new MusicService(root);
try {
  await service.initialize();
  const pulse = service.catalog.pulse;
  pulse.updateSettings({ timeZone: "UTC" });
  const event = {
    eventId: `crash-copy-${cycle}`,
    revision: 1,
    trackId: null,
    albumKey: `crash-copy-${cycle}`,
    snapshot: {
      title: "Crash copy",
      artists: ["Generated fixture"],
      year: null,
      coverId,
    },
    sessionId: `crash-copy-${cycle}`,
    visitId: `crash-copy-${cycle}`,
    startedAtUtc: Date.parse("2026-03-07T12:00:00Z"),
    endedAtUtc: Date.parse("2026-03-07T12:00:15Z"),
    playedMs: 15000,
    final: true,
  };
  if (mode === "restart") {
    const days = pulse.layout("2026-03-07", "2026-03-07").days;
    const total = days.reduce((sum, day) => sum + day.playedMs, 0);
    if (total !== Number(cycle) * 15000)
      throw new Error(
        "Unacknowledged interrupted ingest committed listening time",
      );
    process.send({ type: "before-retry", playedMs: total });
  }
  const batch = {
    historyGeneration: pulse.settings().historyGeneration,
    events: [event],
  };
  const accepted = await pulse.ingest(batch);
  const duplicate = await pulse.ingest(batch);
  const stats = pulse.albumStats(accepted.acknowledgements[0].albumId);
  process.send({
    type: "ack",
    accepted,
    duplicate,
    playedMs: stats.playedMs,
    dayPlayedMs: pulse
      .layout("2026-03-07", "2026-03-07")
      .days.reduce((sum, day) => sum + day.playedMs, 0),
    archive: path.join(root, "pulse-covers", `${coverId}.archive`, "image"),
  });
} finally {
  await service.close();
  process.disconnect();
}

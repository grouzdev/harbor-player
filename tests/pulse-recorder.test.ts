import { describe, expect, it, vi } from "vitest";
import type { Track } from "../src/shared/contracts";
import {
  PulseRecorder,
  attachPulseRecorder,
  type ListeningEvent,
} from "../src/client/pulse-recorder";
import { toPulseEvent } from "../src/client/pulse-event";
import { pulseEventSchema } from "../src/shared/pulse";

function fixture() {
  let clock = 0;
  let sequence = 0;
  const events: ListeningEvent[] = [];
  const recorder = new PulseRecorder(
    (event) => events.push(event),
    1,
    () => clock,
    () => 1_700_000_000_000 + clock,
    () => String(++sequence),
  );
  const track = {
    id: "track",
    albumKey: "album",
    albumTitle: "Album",
    albumArtists: ["Artist"],
    artists: ["Artist"],
  } as Track;
  recorder.source(track);
  return {
    recorder,
    events,
    track,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("PulseRecorder", () => {
  it.each([0.5, 1, 2])("counts elapsed time, not position at %sx", (rate) => {
    const f = fixture();
    f.recorder.playing(0, rate);
    f.advance(15_000.25);
    f.recorder.sample(15.00025 * rate, rate);
    f.advance(0.25);
    f.recorder.close(15.0005 * rate, rate);
    const wire = f.events.map(toPulseEvent);
    expect(wire.map((event) => event.playedMs)).toEqual([15_000, 15_000]);
    expect(wire.map((event) => event.endedAtUtc)).toEqual([
      1_700_000_015_000, 1_700_000_015_000,
    ]);
    expect(wire.map((event) => event.revision)).toEqual([1, 2]);
    expect(wire.map((event) => event.final)).toEqual([false, true]);
    for (const event of wire)
      expect(pulseEventSchema.safeParse(event).success).toBe(true);
  });
  it.each([0.5, 1, 2])(
    "does not accumulate timing loss from bounded position jitter at %sx",
    (rate) => {
      const f = fixture();
      f.recorder.playing(0, rate);
      for (let i = 1; i <= 2400; i++) {
        f.advance(250);
        // Alternating ±5ms position deltas telescope to exactly ten minutes.
        // Clamping each delta to elapsed independently loses six seconds.
        const positionMs = i * 250 - (i % 2 ? 5 : 0);
        f.recorder.sample((positionMs * rate) / 1000, rate);
      }
      f.recorder.close(600 * rate, rate);
      const finals = f.events.filter((event) => event.final);
      expect(finals).toHaveLength(1);
      expect(finals[0].playedMs).toBe(600_000);
      expect(finals[0].endedAt - finals[0].startedAt).toBe(600_000);
      expect(new Set(f.events.map((event) => event.eventId)).size).toBe(1);
    },
  );
  it("rejects a long clock gap despite a small positive media advance", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(1000);
    f.recorder.sample(1, 1);
    f.advance(60_000);
    f.recorder.sample(2, 1);
    f.advance(1000);
    f.recorder.close(3, 1);
    expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000]);
  });
  it("bounds a partially confirmed delayed sample instead of counting the entire gap", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(60_000);
    f.recorder.close(48, 1);
    expect(f.events[0].playedMs).toBe(48_000);
    expect(f.events[0].endedAt - f.events[0].startedAt).toBe(60_000);
  });
  it("bounds published catch-up by each integer UTC tail", () => {
    const f = fixture();
    f.advance(0.125);
    f.recorder.playing(0, 1);
    for (let i = 1; i <= 180; i++) {
      f.advance(251);
      f.recorder.sample((i * 251 - (i <= 60 ? 5 : 0)) / 1000, 1);
    }
    f.recorder.close(45.18, 1);
    const wire = f.events.map(toPulseEvent);
    for (let i = 1; i < wire.length; i++) {
      expect(wire[i].playedMs).toBeGreaterThanOrEqual(wire[i - 1].playedMs);
      expect(wire[i].playedMs - wire[i - 1].playedMs).toBeLessThanOrEqual(
        wire[i].endedAtUtc - wire[i - 1].endedAtUtc,
      );
    }
    expect(wire.at(-1)!.playedMs).toBeGreaterThanOrEqual(45_170);
    expect(wire.at(-1)!.final).toBe(true);
  });
  it("accumulates submillisecond samples but drops an entire interval below 1 ms", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(0.5);
    f.recorder.close(0.0005, 1);
    expect(f.events).toEqual([]);
    f.recorder.playing(0, 1);
    for (let i = 1; i <= 6; i++) {
      f.advance(0.25);
      f.recorder.sample(i * 0.00025, 1);
    }
    f.recorder.close(0.0015, 1);
    expect(f.events).toHaveLength(1);
    expect(toPulseEvent(f.events[0]).playedMs).toBe(1);
    expect(pulseEventSchema.safeParse(toPulseEvent(f.events[0])).success).toBe(
      true,
    );
  });
  it.each([-100, 100])(
    "seek by %ss adds no time and keeps the visit",
    (seek) => {
      const f = fixture();
      f.recorder.playing(200, 1);
      f.advance(1000);
      f.recorder.sample(201, 1);
      f.recorder.close(201 + seek, 1, false);
      f.recorder.playing(201 + seek, 1);
      f.advance(1000);
      f.recorder.close(202 + seek, 1);
      expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000]);
      expect(f.events[0].visitId).toBe(f.events[1].visitId);
    },
  );
  it("anchors UTC to monotonic time despite subsequent wall-clock changes", () => {
    let clock = 0;
    let wall = Date.parse("2026-03-08T06:59:59Z");
    const events: ListeningEvent[] = [];
    const recorder = new PulseRecorder(
      (event) => events.push(event),
      1,
      () => clock,
      () => wall,
    );
    recorder.source(fixture().track);
    recorder.playing(0, 1);
    wall -= 86_400_000;
    clock = 1000;
    recorder.sample(1, 1);
    wall += 2 * 86_400_000;
    clock = 2000;
    recorder.close(2, 1);
    expect(events[0]).toMatchObject({
      startedAt: Date.parse("2026-03-08T06:59:59Z"),
      endedAt: Date.parse("2026-03-08T07:00:01Z"),
      playedMs: 2000,
    });
  });
  it.each(["pause", "waiting", "error", "emptied"])(
    "%s stops counting until playing; a source replacement retains the album visit",
    (stop) => {
      vi.useFakeTimers();
      const f = fixture();
      const audio = Object.assign(new EventTarget(), {
        currentTime: 0,
        playbackRate: 1,
        paused: false,
        ended: false,
      });
      const detach = attachPulseRecorder(audio as HTMLAudioElement, f.recorder);
      try {
        audio.dispatchEvent(new Event("playing"));
        f.advance(1000);
        audio.currentTime = 1;
        audio.dispatchEvent(new Event("timeupdate"));
        audio.dispatchEvent(new Event(stop));
        f.advance(10_000);
        audio.currentTime = 11;
        audio.dispatchEvent(new Event("timeupdate"));
        f.recorder.source({ ...f.track, id: "replaced-source" }, 11, 1);
        audio.dispatchEvent(new Event("playing"));
        f.advance(1000);
        audio.currentTime = 12;
        audio.dispatchEvent(new Event("pause"));
        expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000]);
        expect(f.events.map((event) => event.track.id)).toEqual([
          "track",
          "replaced-source",
        ]);
        expect(f.events[0].visitId).toBe(f.events[1].visitId);
      } finally {
        detach();
        vi.useRealTimers();
      }
    },
  );
  it.each([0.0001, 0.125, 0.9999])(
    "hour segments remain valid on HTTP with fractional monotonic origin %s",
    (fraction) => {
      const f = fixture();
      f.advance(fraction);
      f.recorder.playing(0, 2);
      f.advance(3_600_001.125);
      f.recorder.sample(7200.00225, 2);
      f.recorder.close(7200.00225, 2);
      const events = f.events.map(toPulseEvent);
      expect(events.map((event) => event.playedMs)).toEqual([3_600_000, 1]);
      for (const event of events) {
        expect(pulseEventSchema.safeParse(event).success).toBe(true);
        expect(event.endedAtUtc - event.startedAtUtc).toBeLessThanOrEqual(
          3_600_000,
        );
      }
    },
  );
  it("counts real time at 2x and cumulative checkpoints retain identity", () => {
    const f = fixture();
    f.recorder.playing(0, 2);
    for (let i = 1; i <= 32; i++) {
      f.advance(1000);
      f.recorder.sample(i * 2, 2);
    }
    f.recorder.close(64, 2);
    expect(f.events.map((event) => event.playedMs)).toEqual([
      15000, 30000, 32000,
    ]);
    expect(new Set(f.events.map((event) => event.eventId)).size).toBe(1);
    expect(f.events.map((event) => event.revision)).toEqual([1, 2, 3]);
    expect(f.events.at(-1)?.final).toBe(true);
  });
  it("does not count seeks, stalls, suspended clocks or pauses", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(1000);
    f.recorder.sample(1, 1);
    f.recorder.close(100, 1, false);
    f.recorder.playing(100, 1);
    f.advance(1000);
    f.recorder.sample(100, 1);
    f.advance(60_000);
    f.recorder.sample(100, 1);
    f.advance(1000);
    f.recorder.sample(101, 1);
    f.recorder.close(101, 1);
    expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000]);
  });
  it("repeat and same album tracks get separate events but preserve visit/session", () => {
    const f = fixture();
    const listen = () => {
      f.recorder.playing(0, 1);
      f.advance(1000);
      f.recorder.close(1, 1);
    };
    listen();
    listen();
    f.recorder.source({ ...f.track, id: "next" });
    listen();
    expect(new Set(f.events.map((event) => event.eventId)).size).toBe(3);
    expect(new Set(f.events.map((event) => event.visitId)).size).toBe(1);
    expect(new Set(f.events.map((event) => event.sessionId)).size).toBe(1);
    f.advance(30 * 60_000);
    listen();
    expect(f.events[3].visitId).not.toBe(f.events[2].visitId);
    expect(f.events[3].sessionId).not.toBe(f.events[2].sessionId);
  });
  it("preserves a stable track's visit through moved/retagged source replacement", () => {
    const f = fixture();
    const listen = () => {
      f.recorder.playing(0, 1);
      f.advance(1000);
      f.recorder.close(1, 1);
    };
    listen();
    f.recorder.source({ ...f.track, albumKey: "moved-album" });
    listen();
    f.recorder.source({ ...f.track, id: "next", albumKey: "moved-album" });
    listen();
    expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000, 1000]);
    expect(f.events[0].track.albumKey).toBe("album");
    expect(f.events[1].track.albumKey).toBe("moved-album");
    expect(new Set(f.events.map((event) => event.visitId)).size).toBe(1);
    expect(new Set(f.events.map((event) => event.sessionId)).size).toBe(1);
    f.recorder.source({ ...f.track, id: "other", albumKey: "other-album" });
    listen();
    expect(f.events[3].visitId).not.toBe(f.events[2].visitId);
    f.advance(30 * 60_000);
    f.recorder.source({ ...f.track, id: "other", albumKey: "retagged-other" });
    listen();
    expect(f.events[4].visitId).not.toBe(f.events[3].visitId);
    expect(f.events[4].sessionId).not.toBe(f.events[3].sessionId);
  });
  it("generation change discards an open pre-clear interval", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(1000);
    f.recorder.sample(1, 1);
    f.recorder.setGeneration(2);
    f.recorder.close(1, 1);
    expect(f.events).toEqual([]);
  });
  it("buffering and rate changes close intervals without ending the album visit", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(1000);
    f.recorder.close(1, 1);
    f.advance(10_000);
    f.recorder.playing(1, 2);
    f.advance(1000);
    f.recorder.sample(3, 2);
    f.recorder.close(3, 2, false);
    f.recorder.playing(3, 1);
    f.advance(1000);
    f.recorder.close(4, 1);
    expect(f.events.map((event) => event.playedMs)).toEqual([1000, 1000, 1000]);
    expect(new Set(f.events.map((event) => event.visitId)).size).toBe(1);
  });
  it("hour-long playback splits intervals while keeping the visit", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    for (let i = 1; i <= 3601; i++) {
      f.advance(1000);
      f.recorder.sample(i, 1);
    }
    f.recorder.close(3601, 1);
    const finals = f.events.filter((event) => event.final);
    expect(finals.map((event) => event.playedMs)).toEqual([3_600_000, 1000]);
    expect(finals[0].visitId).toBe(finals[1].visitId);
    expect(finals[0].eventId).not.toBe(finals[1].eventId);
  });
  it("retains confirmed playback across delayed background samples and splits long gaps", () => {
    const f = fixture();
    f.recorder.playing(0, 1);
    f.advance(7_200_000);
    f.recorder.sample(7200, 1);
    f.recorder.close(7200, 1);
    const finals = f.events.filter((event) => event.final);
    expect(finals.map((event) => event.playedMs)).toEqual([
      3_600_000, 3_600_000,
    ]);
    expect(
      finals.every((event) => event.endedAt - event.startedAt <= 3_600_000),
    ).toBe(true);
  });
});

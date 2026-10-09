import { describe, expect, it } from "vitest";
import type { Track } from "../src/shared/contracts";
import {
  PulseRecorder,
  type ListeningEvent,
} from "../src/client/pulse-recorder";

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
  const track = { id: "track", albumKey: "album" } as Track;
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

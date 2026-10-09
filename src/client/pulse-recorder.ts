import type { Track } from "../shared/contracts";

export interface ListeningEvent {
  eventId: string;
  revision: number;
  historyGeneration: number;
  sessionId: string;
  visitId: string;
  track: Track;
  startedAt: number;
  endedAt: number;
  playedMs: number;
  final: boolean;
}

/** Pure accumulator. Position is evidence, never the duration metric itself. */
export class PulseRecorder {
  private track: Track | null = null;
  private active = false;
  private baseline = { time: 0, position: 0, rate: 1 };
  private event: ListeningEvent | null = null;
  private intervalElapsed = 0;
  private intervalProgression = 0;
  private published: { endedAt: number; playedMs: number } | null = null;
  private sessionId: string;
  private visitId: string;
  private albumKey: string | null = null;
  private lastProgress = -Infinity;
  private checkpoint = 0;
  private utcOrigin: number;
  private monotonicOrigin: number;
  constructor(
    private emit: (event: ListeningEvent) => void,
    private generation = 0,
    private now = () => performance.now(),
    wall = () => Date.now(),
    private id = () => crypto.randomUUID(),
  ) {
    this.sessionId = id();
    this.visitId = id();
    this.utcOrigin = wall();
    this.monotonicOrigin = now();
  }
  private utc() {
    return this.utcOrigin + this.now() - this.monotonicOrigin;
  }
  setGeneration(generation: number) {
    if (generation === this.generation) return;
    this.event = null;
    this.active = false;
    this.generation = generation;
  }
  source(track: Track | null, position = 0, rate = 1) {
    this.close(position, rate);
    // Catalog operations can change the album key of the same stable track.
    // Like the server's track alias, that continuity preserves the album visit.
    // playing() still starts a new session after a 30-minute interruption.
    if (
      track &&
      track.id === this.track?.id &&
      this.albumKey === this.track.albumKey
    )
      this.albumKey = track.albumKey;
    this.track = track ? structuredClone(track) : null;
  }
  playing(position: number, rate: number) {
    if (this.active) return;
    const now = this.now();
    if (now - this.lastProgress >= 30 * 60_000) {
      this.sessionId = this.id();
      this.albumKey = null;
    }
    if (this.track?.albumKey !== this.albumKey) {
      this.visitId = this.id();
      this.albumKey = this.track?.albumKey ?? null;
    }
    this.active = true;
    this.baseline = { time: now, position, rate };
  }
  sample(position: number, rate: number) {
    const now = this.now();
    const previous = this.baseline;
    this.baseline = { time: now, position, rate };
    if (!this.active || !this.track) return;
    const elapsed = now - previous.time;
    const progression = ((position - previous.position) * 1000) / previous.rate;
    // Position confirms playback even when background timers are delayed.
    // A clock gap without corresponding progression is not listening.
    if (elapsed <= 0) return;
    if (progression === 0 && elapsed < 250) return;
    if (
      rate !== previous.rate ||
      progression <= 0 ||
      Math.abs(progression - elapsed) > Math.max(250, elapsed * 0.25)
    ) {
      this.finish();
      return;
    }
    this.lastProgress = now;
    let remaining = elapsed;
    let cursor = this.utc() - elapsed;
    while (remaining > 0) {
      if (this.event && cursor - this.event.startedAt >= 3_600_000)
        this.finish();
      if (!this.event) {
        this.event = {
          eventId: this.id(),
          revision: 0,
          historyGeneration: this.generation,
          sessionId: this.sessionId,
          visitId: this.visitId,
          track: this.track,
          startedAt: cursor,
          endedAt: cursor,
          playedMs: 0,
          final: false,
        };
        this.intervalElapsed = 0;
        this.intervalProgression = 0;
        this.published = null;
        this.checkpoint = now - remaining;
      }
      const part = Math.min(
        remaining,
        3_600_000 - (cursor - this.event.startedAt),
      );
      this.intervalElapsed += part;
      this.intervalProgression += progression * (part / elapsed);
      // Cap cumulative elapsed by cumulative progression evidence. A per-sample
      // min loses backward position jitter forever; forward jitter must be
      // able to compensate it before checkpoint/final, without decreasing time.
      this.event.playedMs = Math.min(
        this.intervalElapsed,
        this.intervalProgression,
      );
      cursor += part;
      remaining -= part;
      this.event.endedAt = cursor;
      if (cursor - this.event.startedAt >= 3_600_000) this.finish();
    }
    if (this.event && now - this.checkpoint >= 15_000) {
      this.publish(false);
      this.checkpoint = now;
    }
  }
  close(position: number, rate: number, sample = true) {
    if (sample) this.sample(position, rate);
    this.finish();
    this.active = false;
  }
  private publish(final: boolean) {
    if (!this.event || this.event.playedMs < 1) return;
    const startedAt = Math.floor(this.event.startedAt);
    const endedAt = Math.floor(this.event.endedAt);
    // The server appends only to the new UTC tail, including across midnight.
    // Recovery of old jitter/rounding debt must not revise an accepted prefix.
    const playedMs = Math.min(
      Math.floor(this.event.playedMs),
      this.published
        ? this.published.playedMs + endedAt - this.published.endedAt
        : endedAt - startedAt,
    );
    if (playedMs < 1) return;
    this.event.revision++;
    this.event.final = final;
    this.emit({
      ...structuredClone(this.event),
      startedAt,
      endedAt,
      playedMs,
    });
    this.published = { endedAt, playedMs };
  }
  private finish() {
    this.publish(true);
    this.event = null;
  }
}

export function attachPulseRecorder(
  audio: HTMLAudioElement,
  recorder: PulseRecorder,
) {
  const sample = () => recorder.sample(audio.currentTime, audio.playbackRate);
  const play = () => recorder.playing(audio.currentTime, audio.playbackRate);
  const close = () => recorder.close(audio.currentTime, audio.playbackRate);
  const seek = () =>
    recorder.close(audio.currentTime, audio.playbackRate, false);
  const resume = () => {
    if (!audio.paused && !audio.ended) play();
  };
  const listeners: Record<string, EventListener> = {
    playing: play,
    timeupdate: sample,
    pause: close,
    waiting: close,
    seeking: seek,
    seeked: resume,
    ended: close,
    error: close,
    emptied: seek,
    ratechange: () => {
      seek();
      resume();
    },
  };
  for (const [name, listener] of Object.entries(listeners))
    audio.addEventListener(name, listener);
  const timer = setInterval(sample, 1000);
  return () => {
    clearInterval(timer);
    close();
    for (const [name, listener] of Object.entries(listeners))
      audio.removeEventListener(name, listener);
  };
}

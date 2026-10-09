import type { PulseEvent } from "../shared/pulse";
import type { ListeningEvent } from "./pulse-recorder";

/**
 * HTTP stores whole milliseconds: floor cumulative duration and UTC bounds.
 * Recorder never publishes an interval below 1 ms; final may add no whole ms.
 */
export function toPulseEvent(event: ListeningEvent): PulseEvent {
  return {
    eventId: event.eventId,
    revision: event.revision,
    trackId: event.track.id,
    albumKey: event.track.albumKey,
    snapshot: {
      title: event.track.albumTitle,
      artists: event.track.albumArtists.length
        ? event.track.albumArtists
        : event.track.artists,
      year: event.track.year ?? null,
      coverId: event.track.coverId ?? null,
    },
    sessionId: event.sessionId,
    visitId: event.visitId,
    startedAtUtc: Math.floor(event.startedAt),
    endedAtUtc: Math.floor(event.endedAt),
    playedMs: Math.floor(event.playedMs),
    final: event.final,
  };
}

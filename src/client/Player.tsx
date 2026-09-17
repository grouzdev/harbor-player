import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CatalogFilter, Track } from "../shared/contracts";
import { api, duration } from "./api";

interface Queue {
  id: string;
  position: number;
  total: number;
  track: Track | null;
}
export function usePlayer(notify: (message: string) => void) {
  const audio = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(() => {
    const n = Number(localStorage.getItem("mml-volume") ?? 0.7);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.7;
  });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("off");
  const shouldPlay = useRef(false);
  const seekAfterLoad = useRef(0);
  const interrupted = useRef<{
    playing: boolean;
    position: number;
    id: string;
  } | null>(null);
  const events = useRef<(event: any) => void>(() => {});
  const transition = useRef(0);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    localStorage.setItem("mml-volume", String(volume));
  }, [volume]);
  useEffect(() => {
    const saved = localStorage.getItem("mml-queue");
    if (!saved) return;
    try {
      const q = JSON.parse(saved);
      api<Queue>(`/queue/${q.id}?position=${q.position}`)
        .then(setQueue)
        .catch(() => localStorage.removeItem("mml-queue"));
    } catch {
      localStorage.removeItem("mml-queue");
    }
  }, []);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.pause();
    setPosition(0);
    if (!queue?.track?.available) {
      element.removeAttribute("src");
      element.load();
      setPlaying(false);
      return;
    }
    element.src = `/api/audio/${queue.track.id}?v=${queue.track.mtimeMs}`;
    element.load();
    localStorage.setItem(
      "mml-queue",
      JSON.stringify({ id: queue.id, position: queue.position }),
    );
    setLength(queue.track.duration);
  }, [queue]);
  const loadQueue = async (
    body:
      | { filter: CatalogFilter; startId?: string }
      | { albumId: string; startId?: string },
  ) => {
    const sequence = ++transition.current;
    try {
      const q = await api<Queue>("/queue", body);
      if (sequence !== transition.current) return false;
      shouldPlay.current = true;
      seekAfterLoad.current = 0;
      setQueue(q);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  };
  const start = (track: Track, filter: CatalogFilter) =>
    loadQueue({ filter, startId: track.id });
  const startFilter = (filter: CatalogFilter, startId?: string) =>
    loadQueue({ filter, startId });
  const startAlbum = (albumId: string, startId?: string) =>
    loadQueue({ albumId, startId });
  const step = async (direction: number, ended = false) => {
    if (!queue) return;
    if (direction < 0 && position > 3) {
      if (audio.current) audio.current.currentTime = 0;
      return;
    }
    if (ended && repeat === "one") {
      if (audio.current) {
        audio.current.currentTime = 0;
        audio.current.play().catch((e) => notify(e.message));
      }
      return;
    }
    let next =
      shuffle && direction > 0 && queue.total > 1
        ? (queue.position + 1 + Math.floor(Math.random() * (queue.total - 1))) %
          queue.total
        : queue.position + direction;
    if (next < 0 || next >= queue.total) {
      if (repeat === "all") next = (next + queue.total) % queue.total;
      else {
        setPlaying(false);
        return;
      }
    }
    const sequence = ++transition.current;
    try {
      let q: Queue | null = null;
      // Skip deleted entries while retaining the original snapshot order.
      for (let i = 0; i < queue.total; i++) {
        q = await api<Queue>(`/queue/${queue.id}?position=${next}`);
        if (q.track?.available) break;
        next += direction;
        if (next < 0 || next >= queue.total) {
          q = null;
          break;
        }
      }
      if (sequence !== transition.current) return;
      if (q?.track?.available) {
        shouldPlay.current = true;
        seekAfterLoad.current = 0;
        setQueue(q);
      } else setPlaying(false);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const toggle = () => {
    if (!audio.current || !queue?.track || interrupted.current) return;
    if (audio.current.paused)
      audio.current.play().catch((e) => notify(e.message));
    else audio.current.pause();
  };
  events.current = async (event) => {
    const element = audio.current;
    if (!element || !queue?.track) return;
    if (
      event.type === "operation-start" &&
      event.trackIds.includes(queue.track.id)
    ) {
      interrupted.current = {
        id: queue.track.id,
        playing: !element.paused,
        position: element.currentTime,
      };
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    if (event.type === "operation-finished" && interrupted.current) {
      const previous = interrupted.current;
      interrupted.current = null;
      try {
        const track = await api<Track>(`/tracks/${previous.id}`);
        shouldPlay.current = previous.playing && track.available;
        seekAfterLoad.current = previous.position;
        setQueue({ ...queue, track: track.available ? track : null });
      } catch (e) {
        notify((e as Error).message);
      }
    }
  };
  useEffect(() => {
    if (!("mediaSession" in navigator) || !queue?.track) return;
    const track = queue.track;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.join(", "),
      album: track.albumTitle,
      artwork: track.coverId
        ? [{ src: `${location.origin}/api/covers/${track.coverId}` }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () =>
      audio.current?.play().catch((e) => notify(e.message)),
    );
    navigator.mediaSession.setActionHandler("pause", () =>
      audio.current?.pause(),
    );
    navigator.mediaSession.setActionHandler("nexttrack", () => void step(1));
    navigator.mediaSession.setActionHandler(
      "previoustrack",
      () => void step(-1),
    );
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    return () => {
      for (const action of [
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
      ] as const)
        navigator.mediaSession.setActionHandler(action, null);
    };
  }, [queue, playing, shuffle, repeat, position]);
  const audioElement = (
    <audio
      ref={audio}
      preload="metadata"
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => void step(1, true)}
      onLoadedMetadata={() => {
        const el = audio.current!;
        setLength(el.duration);
        if (seekAfterLoad.current) {
          el.currentTime = Math.min(seekAfterLoad.current, el.duration || 0);
          seekAfterLoad.current = 0;
        }
        if (shouldPlay.current) {
          shouldPlay.current = false;
          el.play().catch(() =>
            notify("Нажмите «Воспроизвести», чтобы разрешить звук в браузере."),
          );
        }
      }}
      onError={() => {
        if (interrupted.current || !audio.current?.getAttribute("src")) return;
        setPlaying(false);
        notify(
          "Не удалось воспроизвести файл. Проверьте доступность библиотеки и поддержку формата браузером.",
        );
      }}
    />
  );
  return {
    queue,
    playing,
    position,
    length,
    volume,
    shuffle,
    repeat,
    audioElement,
    events,
    start,
    startFilter,
    startAlbum,
    toggle,
    step,
    setVolume,
    setShuffle,
    setRepeat,
    seek: (value: number) => {
      if (audio.current) audio.current.currentTime = value;
    },
  };
}

export function Player({
  player,
  onNavigateToAlbum,
  onNavigateToArtist,
  coverMode,
  onToggleCoverMode,
}: {
  player: ReturnType<typeof usePlayer>;
  onNavigateToAlbum: (albumId: string, albumArtists: string[]) => void;
  onNavigateToArtist: (artist: string) => void;
  coverMode: boolean;
  onToggleCoverMode: () => void;
}) {
  const track = player.queue?.track;
  const seekProgress =
    player.length > 0
      ? Math.min(100, Math.max(0, (player.position / player.length) * 100))
      : 0;
  const seekStyle = {
    "--range-progress": `${seekProgress}%`,
  } as CSSProperties;
  const volumeStyle = {
    "--range-progress": `${Math.min(100, Math.max(0, player.volume * 100))}%`,
  } as CSSProperties;
  const albumArtists = track?.albumArtists.length
    ? track.albumArtists
    : track?.artists || [];
  return (
    <footer className="player">
      {player.audioElement}
      <div className="now-playing">
        <button
          type="button"
          className="now-cover"
          aria-label={
            coverMode ? "Вернуться в каталог" : "Открыть режим обложки"
          }
          aria-pressed={coverMode}
          disabled={!track}
          title={coverMode ? "Вернуться в каталог" : "Открыть режим обложки"}
          onClick={onToggleCoverMode}
        >
          {track?.coverId ? (
            <img src={`/api/covers/${track.coverId}`} alt="" />
          ) : (
            <Music2 size={22} />
          )}
        </button>
        <div className="now-copy">
          {track ? (
            <span className="now-artists">
              {albumArtists.length ? (
                albumArtists.map((artist, index) => (
                  <span key={`${artist}-${index}`}>
                    {index > 0 && ", "}
                    <button
                      type="button"
                      className="now-artist-link"
                      aria-label={`Открыть исполнителя «${artist}»`}
                      onClick={() => onNavigateToArtist(artist)}
                    >
                      {artist}
                    </button>
                  </span>
                ))
              ) : (
                <button
                  type="button"
                  className="now-artist-link"
                  aria-label="Открыть неизвестного исполнителя"
                  onClick={() => onNavigateToArtist("")}
                >
                  Неизвестный исполнитель
                </button>
              )}
            </span>
          ) : (
            <strong>Ваша музыка — здесь</strong>
          )}
          {track ? (
            <button
              type="button"
              className="now-track-link"
              aria-label={`Открыть альбом «${track.albumTitle || "Без альбома"}»`}
              onClick={() => onNavigateToAlbum(track.albumKey, albumArtists)}
            >
              {track.title || "Без названия"}
            </button>
          ) : (
            <span>Выберите трек для воспроизведения</span>
          )}
        </div>
        {track && <span className="format-badge">{track.format}</span>}
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            className="icon-button"
            aria-label="Предыдущий трек"
            disabled={!track}
            onClick={() => void player.step(-1)}
          >
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button
            className="play-button"
            aria-label={player.playing ? "Пауза" : "Воспроизвести"}
            disabled={!track}
            onClick={player.toggle}
          >
            {player.playing ? (
              <Pause size={23} fill="currentColor" />
            ) : (
              <Play size={23} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Следующий трек"
            disabled={!track}
            onClick={() => void player.step(1)}
          >
            <SkipForward size={20} fill="currentColor" />
          </button>
        </div>
        <div className="seek">
          <span className="seek-time">{duration(player.position)}</span>
          <div className="range-shell seek-range" style={seekStyle}>
            <input
              aria-label="Позиция воспроизведения"
              type="range"
              min="0"
              max={Number.isFinite(player.length) ? player.length : 0}
              step="0.1"
              value={player.position}
              disabled={!track}
              onChange={(e) => player.seek(Number(e.target.value))}
            />
          </div>
          <span className="seek-time">{duration(player.length)}</span>
        </div>
      </div>
      <div className="volume">
        <span className="queue-count">
          {player.queue
            ? `${player.queue.position + 1} / ${player.queue.total}`
            : "Локальное воспроизведение"}
        </span>
        <button
          className={`icon-button player-volume-control ${player.volume === 0 ? "active" : ""}`}
          aria-label={player.volume ? "Выключить звук" : "Включить звук"}
          aria-pressed={player.volume === 0}
          onClick={() => player.setVolume(player.volume ? 0 : 0.7)}
        >
          {player.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <div
          className="range-shell volume-range player-volume-control"
          style={volumeStyle}
        >
          <input
            aria-label="Громкость"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
          />
        </div>
        <button
          className={`icon-button player-playback-mode ${player.repeat !== "off" ? "active" : ""}`}
          aria-label={`Повтор: ${player.repeat === "off" ? "выключен" : player.repeat === "all" ? "вся очередь" : "один трек"}`}
          aria-pressed={player.repeat !== "off"}
          onClick={() =>
            player.setRepeat(
              player.repeat === "off"
                ? "all"
                : player.repeat === "all"
                  ? "one"
                  : "off",
            )
          }
        >
          {player.repeat === "one" ? (
            <Repeat1 size={17} />
          ) : (
            <Repeat size={17} />
          )}
        </button>
        <button
          className={`icon-button player-playback-mode ${player.shuffle ? "active" : ""}`}
          aria-label="Перемешать"
          aria-pressed={player.shuffle}
          onClick={() => player.setShuffle(!player.shuffle)}
        >
          <Shuffle size={17} />
        </button>
      </div>
    </footer>
  );
}

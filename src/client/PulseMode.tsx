import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { api } from "./api";
import {
  ALBUM_WIDTH,
  DAY_PADDING,
  PulseLayout,
  calendarDay,
  calendarKey,
  wheelDistance,
  type PulseDayLayout,
} from "./pulse-layout";
import "./styles/pulse.css";

export interface PulseAlbumCard {
  albumId: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  playedMs: number;
}
export interface PulseAlbumStats {
  album: PulseAlbumCard;
  playedMs: number;
  dayCount: number;
  sameDayReturns: number;
  firstDate: string;
  lastDate: string;
  dayPlayedMs: number;
  dayTotalMs: number;
}
export interface PulseHistory {
  from: string | null;
  to: string;
  enabled: boolean;
  generation: string | number;
}
/** readAlbums must return the requested rank window, never an unbounded day. */
export interface PulseAdapter {
  invalidate?(): void;
  history(signal: AbortSignal): Promise<PulseHistory>;
  layout(
    from: string,
    to: string,
    signal: AbortSignal,
  ): Promise<PulseDayLayout[]>;
  albums(
    day: string,
    start: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<PulseAlbumCard[]>;
  stats(
    albumId: string,
    day: string,
    signal: AbortSignal,
  ): Promise<PulseAlbumStats>;
}
export interface PulseViewState {
  date: string;
  offset: number;
  selectedAlbumId?: string;
  selectedDay?: string;
}
export interface PulseModeProps {
  adapter?: PulseAdapter;
  initialState?: PulseViewState;
  onStateChange?: (state: PulseViewState) => void;
  settingsControls?: ReactNode;
  onSettings?: () => void;
}
interface WireAlbum {
  albumId: string;
  title: string;
  artists: string[];
  coverId: string | null;
  playedMs: number;
}
function mapAlbum(album: WireAlbum): PulseAlbumCard {
  return {
    albumId: album.albumId,
    title: album.title,
    artist: album.artists.join(", "),
    coverUrl: album.coverId
      ? `/api/covers/${encodeURIComponent(album.coverId)}`
      : null,
    playedMs: album.playedMs,
  };
}
async function pulseGet<T>(path: string, signal: AbortSignal): Promise<T> {
  return api<T>(path.replace(/^\/api/, ""), undefined, "GET", { signal });
}
/** A small LRU, not an accumulating cache of every visited year. */
function boundedCache<T>(maximum: number) {
  const entries = new Map<string, { value: T; at: number }>();
  return {
    clear: () => entries.clear(),
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry || Date.now() - entry.at > 30_000) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T) {
      entries.delete(key);
      entries.set(key, { value, at: Date.now() });
      while (entries.size > maximum)
        entries.delete(entries.keys().next().value!);
    },
  };
}
export function createPulseApiAdapter(): PulseAdapter {
  const pages = boundedCache<PulseAlbumCard[]>(24);
  const statistics = boundedCache<PulseAlbumStats>(16);
  let generation: string | number | undefined;
  let timeZone = "UTC";
  const localDate = (timestamp: number) => {
    const parts = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(new Date(timestamp));
    const value = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  return {
    invalidate() {
      pages.clear();
      statistics.clear();
    },
    async history(signal) {
      // Listening may have changed while this screen was unmounted.
      pages.clear();
      statistics.clear();
      const range = await pulseGet<{
        firstDay: string | null;
        lastDay: string | null;
        enabled: boolean;
        historyGeneration: number;
        timeZone: string | null;
      }>("/api/pulse/history-range", signal);
      if (generation !== range.historyGeneration) {
        pages.clear();
        statistics.clear();
      }
      generation = range.historyGeneration;
      timeZone = range.timeZone ?? "UTC";
      return {
        from: range.firstDay,
        to: range.lastDay ?? localDate(Date.now()),
        enabled: range.enabled,
        generation: range.historyGeneration,
      };
    },
    async layout(from, to, signal) {
      const result = await pulseGet<{
        days: {
          dayKey: string;
          playedMs: number;
          albumCount: number;
          maxAlbumMs: number;
        }[];
      }>(`/api/pulse/layout?from=${from}&to=${to}`, signal);
      return result.days.map((day) => ({ ...day, date: day.dayKey }));
    },
    async albums(day, start, limit, signal) {
      const key = `${generation}:${day}:${start}:${limit}`;
      const cached = pages.get(key);
      if (cached) return cached;
      const result = await pulseGet<{ items: WireAlbum[] }>(
        `/api/pulse/days/${day}/albums?offset=${start}&limit=${limit}`,
        signal,
      );
      const cards = result.items.map(mapAlbum);
      if (!signal.aborted) pages.set(key, cards);
      return cards;
    },
    async stats(albumId, day, signal) {
      const key = `${generation}:${albumId}:${day}`;
      const cached = statistics.get(key);
      if (cached) return cached;
      const result = await pulseGet<
        WireAlbum & {
          album?: WireAlbum;
          dayCount: number;
          sameDayReturns: number;
          firstPlayedAtUtc: number;
          lastPlayedAtUtc: number;
          dayPlayedMs: number;
          dayTotalMs: number;
        }
      >(
        `/api/pulse/albums/${encodeURIComponent(albumId)}/stats?day=${day}`,
        signal,
      );
      const snapshot = result.album ?? result;
      const stats = {
        album: mapAlbum(snapshot),
        playedMs: result.playedMs,
        dayCount: result.dayCount,
        sameDayReturns: result.sameDayReturns,
        firstDate: localDate(result.firstPlayedAtUtc),
        lastDate: localDate(result.lastPlayedAtUtc),
        dayPlayedMs: result.dayPlayedMs,
        dayTotalMs: result.dayTotalMs,
      };
      if (!signal.aborted) statistics.set(key, stats);
      return stats;
    },
  };
}
const defaultPulseAdapter = createPulseApiAdapter();
const dateFormat = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const weekday = new Intl.DateTimeFormat("ru", {
  weekday: "short",
  timeZone: "UTC",
});
const month = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function duration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
    : `${minutes} мин`;
}
function Cover({ album }: { album: PulseAlbumCard }) {
  return album.coverUrl ? (
    <img
      className="pulse-cover"
      src={album.coverUrl}
      alt=""
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  ) : (
    <span className="pulse-cover pulse-missing" aria-hidden="true">
      ♫
    </span>
  );
}

function AlbumDay({
  layout,
  index,
  rail,
  left,
  viewport,
  plotHeight,
  adapter,
  selected,
  select,
}: {
  layout: PulseLayout;
  index: number;
  rail: React.RefObject<HTMLDivElement | null>;
  left: number;
  viewport: number;
  plotHeight: number;
  adapter: PulseAdapter;
  selected?: string;
  select: (album: PulseAlbumCard, day: string) => void;
}) {
  const day = layout.date(index);
  const start = layout.start(index);
  const count = layout.day(index)?.albumCount ?? 0;
  const focusedCard = useRef<{ index: number; album: PulseAlbumCard } | null>(
    null,
  );
  const virtual = useVirtualizer({
    count,
    horizontal: true,
    getScrollElement: () => rail.current,
    estimateSize: () => ALBUM_WIDTH,
    scrollMargin: start + DAY_PADDING,
    // This is an observer of the shared rail, not a second scroll owner.
    // A newly mounted day's default scrollTo would reset the whole timeline.
    scrollToFn: () => {},
    overscan: 3,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      return focusedCard.current === null
        ? visible
        : [...new Set([...visible, focusedCard.current.index])].sort(
            (a, b) => a - b,
          );
    },
  });
  const items = virtual.getVirtualItems();
  const first = Math.max(
    0,
    Math.floor((left - start - DAY_PADDING) / ALBUM_WIDTH) - 3,
  );
  const last = Math.min(
    count - 1,
    Math.ceil((left + viewport - start - DAY_PADDING) / ALBUM_WIDTH) + 3,
  );
  const [cards, setCards] = useState<{
    start: number;
    cards: PulseAlbumCard[];
  }>({ start: 0, cards: [] });
  const [error, setError] = useState(false);
  // Fixed-sized pages bound cache and make panning within a page request-free.
  const page = Math.floor(first / 20) * 20;
  const end = Math.min(count, Math.ceil((last + 1) / 20) * 20);
  useEffect(() => {
    if (!count || end <= page) return;
    const controller = new AbortController();
    setError(false);
    void adapter
      .albums(day, page, Math.min(100, end - page), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setCards({ start: page, cards: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [adapter, layout, day, count, page, end]);
  const date = new Date(`${day}T00:00:00Z`);
  const labelLeft = Math.max(
    8,
    Math.min(layout.width(index) - 58, left - start + 12),
  );
  return (
    <div
      className={`pulse-day ${count ? "" : "pulse-quiet"}`}
      data-day={day}
      style={{ left: start, width: layout.width(index) }}
    >
      <div className="pulse-albums" style={{ height: plotHeight + 28 }}>
        {items.map((item) => {
          const album =
            focusedCard.current?.index === item.index
              ? focusedCard.current.album
              : cards.cards[item.index - cards.start];
          return (
            <div
              key={item.key}
              className="pulse-card-slot"
              style={{
                left: DAY_PADDING + item.index * ALBUM_WIDTH,
                width: ALBUM_WIDTH,
              }}
            >
              {album ? (
                <button
                  type="button"
                  className="pulse-album"
                  onFocus={() => {
                    focusedCard.current = { index: item.index, album };
                  }}
                  onBlur={() => {
                    focusedCard.current = null;
                  }}
                  aria-pressed={selected === album.albumId}
                  aria-label={`${album.title}, ${album.artist}, ${duration(album.playedMs)}, ${dateFormat.format(date)}`}
                  onClick={() => select(album, day)}
                >
                  <span className="pulse-plot" style={{ height: plotHeight }}>
                    <Cover album={album} />
                    <span
                      className="pulse-stem"
                      style={{
                        height: Math.max(
                          1,
                          (album.playedMs / Math.max(1, layout.maxAlbumMs)) *
                            Math.max(
                              1,
                              plotHeight -
                                Math.min(80, Math.max(24, plotHeight * 0.45)) -
                                10,
                            ),
                        ),
                      }}
                    />
                  </span>
                  <span className="pulse-time">{duration(album.playedMs)}</span>
                </button>
              ) : (
                <span
                  className="pulse-card-loading"
                  aria-label={
                    error ? "Ошибка загрузки альбомов" : "Загрузка альбома"
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="pulse-axis">
        <div
          className="pulse-day-label"
          style={{
            left: labelLeft,
            maxWidth: Math.min(viewport, layout.width(index)),
          }}
        >
          <span className="pulse-day-number">{date.getUTCDate()}</span>
          <span>
            <span className="pulse-weekday">{weekday.format(date)}</span>
            <small>
              {
                month.formatToParts(date).find((part) => part.type === "month")
                  ?.value
              }
            </small>
          </span>
        </div>
      </div>
    </div>
  );
}

export function PulseMode({
  adapter = defaultPulseAdapter,
  initialState,
  onStateChange,
  settingsControls,
  onSettings,
}: PulseModeProps) {
  const rail = useRef<HTMLDivElement>(null);
  const state = useRef<PulseViewState | undefined>(initialState);
  const notify = useRef(onStateChange);
  notify.current = onStateChange;
  const [layout, setLayout] = useState<PulseLayout>();
  const [history, setHistory] = useState<PulseHistory>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [position, setPosition] = useState({ left: 0, width: 0, height: 0 });
  const [slider, setSlider] = useState(0);
  const [selection, setSelection] = useState<
    { albumId: string; day: string; album?: PulseAlbumCard } | undefined
  >(
    initialState?.selectedAlbumId
      ? {
          albumId: initialState.selectedAlbumId,
          day: initialState.selectedDay ?? initialState.date,
        }
      : undefined,
  );
  const [stats, setStats] = useState<PulseAlbumStats>();
  const [statsError, setStatsError] = useState(false);
  const focusedDay = useRef<number | null>(null);
  const historyGeneration = useRef<string | number | undefined>(undefined);
  const autoSelected = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        adapter.invalidate?.();
        setRevision((value) => value + 1);
      }, 100);
    };
    window.addEventListener("harbor-pulse-settings-changed", refresh);
    window.addEventListener("harbor-pulse-updated", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("harbor-pulse-settings-changed", refresh);
      window.removeEventListener("harbor-pulse-updated", refresh);
    };
  }, [adapter]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void (async () => {
      const range = await adapter.history(controller.signal);
      if (controller.signal.aborted) return;
      if (
        historyGeneration.current !== undefined &&
        historyGeneration.current !== range.generation
      ) {
        setSelection(undefined);
        setStats(undefined);
        state.current = undefined;
        autoSelected.current = false;
      }
      historyGeneration.current = range.generation;
      setHistory(range);
      if (!range.from) {
        setLayout(undefined);
        return;
      }
      const entries: PulseDayLayout[] = [];
      // Metadata only: no album snapshots or images outside the viewport.
      for (
        let day = calendarDay(range.from);
        day <= calendarDay(range.to);
        day += 366
      ) {
        const result = await adapter.layout(
          calendarKey(day),
          calendarKey(Math.min(day + 365, calendarDay(range.to))),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        entries.push(...result);
      }
      const next = new PulseLayout(range.from, range.to, entries);
      setLayout(next);
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить историю",
        );
    });
    return () => controller.abort();
  }, [adapter, revision]);
  const days = useVirtualizer({
    count: layout?.count ?? 0,
    horizontal: true,
    getScrollElement: () => rail.current,
    estimateSize: (index) => layout?.width(index) ?? 64,
    overscan: 2,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      return focusedDay.current === null
        ? visible
        : [...new Set([...visible, focusedDay.current])].sort((a, b) => a - b);
    },
  });
  useEffect(() => {
    days.measure();
  }, [layout, days]);
  useEffect(() => {
    const element = rail.current;
    if (!element || !layout) return;
    const saved = state.current;
    element.scrollLeft = saved
      ? layout.start(layout.index(saved.date)) +
        Math.min(saved.offset, layout.width(layout.index(saved.date)) - 1)
      : Math.max(0, layout.totalWidth - element.clientWidth);
    let frame = 0;
    const update = () => {
      frame = 0;
      const located = layout.locate(element.scrollLeft);
      const next = {
        date: layout.date(located.index),
        offset: located.offset,
        selectedAlbumId: state.current?.selectedAlbumId,
        selectedDay: state.current?.selectedDay,
      };
      state.current = next;
      setPosition({
        left: element.scrollLeft,
        width: element.clientWidth,
        height: element.clientHeight,
      });
      setSlider(located.index);
      notify.current?.(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      element.scrollLeft += wheelDistance(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        element.clientWidth,
      );
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.addEventListener("scroll", schedule, { passive: true });
    element.addEventListener("wheel", wheel, { passive: false });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", schedule);
      element.removeEventListener("wheel", wheel);
    };
  }, [layout]);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    setStats(undefined);
    setStatsError(false);
    void adapter
      .stats(selection.albumId, selection.day, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStats(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatsError(true);
      });
    return () => controller.abort();
  }, [adapter, selection, revision]);
  function select(album: PulseAlbumCard, day: string) {
    setSelection({ albumId: album.albumId, day, album });
    if (state.current) {
      state.current = {
        ...state.current,
        selectedAlbumId: album.albumId,
        selectedDay: day,
      };
      notify.current?.(state.current);
    }
  }
  // Latest listening day, without changing playback or the queue.
  useEffect(() => {
    if (!layout || selection || autoSelected.current) return;
    let last = layout.count - 1;
    while (last >= 0 && !layout.day(last)) last--;
    if (last < 0) return;
    const controller = new AbortController();
    const day = layout.date(last);
    void adapter
      .albums(
        day,
        Math.max(0, layout.day(last)!.albumCount - 1),
        1,
        controller.signal,
      )
      .then((cards) => {
        if (!controller.signal.aborted && cards[0]) {
          autoSelected.current = true;
          select(cards[0], day);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [adapter, layout, selection]);
  const drag = useRef<{ id: number; x: number; left: number } | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(jumpTimer.current), []);
  function jump(index: number, immediate = false) {
    setSlider(index);
    clearTimeout(jumpTimer.current);
    const apply = () => {
      if (layout && rail.current) rail.current.scrollLeft = layout.start(index);
    };
    if (immediate) apply();
    else jumpTimer.current = setTimeout(apply, 70);
  }
  const album = selection?.album ?? stats?.album;
  const years: { year: number; index: number }[] = [];
  if (layout) {
    const firstYear = Number(layout.from.slice(0, 4));
    const lastYear = Number(layout.to.slice(0, 4));
    for (let year = firstYear; year <= lastYear; year++)
      years.push({ year, index: layout.index(`${year}-01-01`) });
  }
  const share = stats?.dayTotalMs
    ? Math.round((stats.dayPlayedMs / stats.dayTotalMs) * 100)
    : 0;
  return (
    <section className="pulse-mode" aria-label="История прослушивания">
      <div className="pulse-selection">
        <div className="pulse-selected">
          {album && (
            <>
              <Cover album={album} />
              <div className="pulse-copy">
                <p className="pulse-date">
                  {selection &&
                    dateFormat.format(new Date(`${selection.day}T00:00:00Z`))}
                </p>
                <h2>{album.title}</h2>
                <p>{album.artist}</p>
                <small>
                  {duration(stats?.dayPlayedMs ?? album.playedMs)} за этот день
                </small>
              </div>
            </>
          )}
        </div>
        <aside
          className="pulse-statistics"
          aria-label="Статистика выбранного альбома"
        >
          <div className="pulse-settings">
            {settingsControls}
            {onSettings && (
              <button
                type="button"
                onClick={onSettings}
                aria-label="Настройки истории"
              >
                Настройки
              </button>
            )}
          </div>
          {stats ? (
            <>
              <div className="pulse-stat-numbers">
                <div>
                  <strong>{duration(stats.playedMs)}</strong>
                  <small>за всю историю</small>
                </div>
                <div>
                  <strong>{stats.dayCount}</strong>
                  <small>дней с альбомом</small>
                </div>
                <div>
                  <strong>{stats.sameDayReturns}</strong>
                  <small>возвратов в тот же день</small>
                </div>
              </div>
              <p className="pulse-share">
                Доля музыки за день <strong>{share}%</strong>
              </p>
              <div className="pulse-share-bar">
                <i style={{ width: `${share}%` }} />
              </div>
              <p className="pulse-facts">
                Первое прослушивание — {stats.firstDate}
                <br />
                Последнее — {stats.lastDate}
              </p>
            </>
          ) : (
            selection && (
              <p role="status">
                {statsError
                  ? "Не удалось загрузить статистику альбома"
                  : "Загрузка статистики…"}
              </p>
            )
          )}
        </aside>
      </div>
      {error ? (
        <div className="pulse-empty" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить
          </button>
        </div>
      ) : !layout ? (
        <div className="pulse-empty" role="status">
          {history
            ? history.enabled
              ? "История прослушивания пока пуста"
              : "Сбор истории отключён"
            : "Загрузка истории…"}
        </div>
      ) : (
        <div
          ref={rail}
          className="pulse-rail"
          tabIndex={0}
          role="region"
          aria-label="Все альбомы по дням и прослушанное время"
          style={
            {
              "--pulse-cover-size": `${Math.min(80, Math.max(24, (position.height - 92) * 0.45))}px`,
            } as CSSProperties
          }
          onFocusCapture={(event) => {
            const day = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-day]",
            )?.dataset.day;
            focusedDay.current = day ? layout.index(day) : null;
          }}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              focusedDay.current = null;
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const element = event.currentTarget;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              element.scrollLeft += event.key === "ArrowRight" ? 100 : -100;
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              element.scrollLeft = event.key === "Home" ? 0 : layout.totalWidth;
            }
            if (event.key === "PageDown" || event.key === "PageUp") {
              event.preventDefault();
              element.scrollLeft +=
                element.clientWidth * (event.key === "PageDown" ? 1 : -1);
            }
          }}
          onPointerDown={(event) => {
            if (
              event.pointerType !== "mouse" ||
              event.button !== 0 ||
              (event.target as HTMLElement).closest(
                ".pulse-cover, .pulse-stem, .pulse-time, button:not(.pulse-album)",
              )
            )
              return;
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              left: event.currentTarget.scrollLeft,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.add("pulse-dragging");
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (drag.current?.id === event.pointerId)
              event.currentTarget.scrollLeft =
                drag.current.left - event.clientX + drag.current.x;
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.classList.remove("pulse-dragging");
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            drag.current = null;
            event.currentTarget.classList.remove("pulse-dragging");
          }}
          onLostPointerCapture={(event) => {
            drag.current = null;
            event.currentTarget.classList.remove("pulse-dragging");
          }}
        >
          <div
            className="pulse-days"
            style={{ width: layout.totalWidth, height: "100%" }}
          >
            {days.getVirtualItems().map((item) => (
              <AlbumDay
                key={layout.date(item.index)}
                layout={layout}
                index={item.index}
                rail={rail}
                left={position.left}
                viewport={position.width}
                plotHeight={Math.max(24, position.height - 92)}
                adapter={adapter}
                selected={selection?.albumId}
                select={select}
              />
            ))}
          </div>
        </div>
      )}
      {layout && (
        <nav
          className="pulse-history-range"
          aria-label="Вся история прослушивания"
        >
          <input
            type="range"
            min={0}
            max={layout.count - 1}
            step={1}
            value={slider}
            aria-label="Дата на таймлайне"
            aria-valuetext={layout.date(slider)}
            onChange={(event) => jump(Number(event.target.value))}
            onPointerUp={(event) =>
              jump(Number(event.currentTarget.value), true)
            }
            onKeyUp={(event) => jump(Number(event.currentTarget.value), true)}
          />
          {years.map(({ year, index }) => (
            <span
              key={year}
              className="pulse-year"
              style={{
                left: `${(index / Math.max(1, layout.count - 1)) * 100}%`,
              }}
            >
              {year}
            </span>
          ))}
        </nav>
      )}
    </section>
  );
}

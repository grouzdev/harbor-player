/** Calendar keys are dates in the history's timezone, not local instants. */
export const DAY_MS = 86_400_000;
export const EMPTY_DAY_WIDTH = 64;
export const ALBUM_WIDTH = 100;
export const DAY_PADDING = 14;
export interface PulseDayLayout {
  date: string;
  albumCount: number;
  maxAlbumMs: number;
  playedMs: number;
}
export function calendarDay(date: string): number {
  const value = Date.parse(`${date}T00:00:00Z`) / DAY_MS;
  if (!Number.isInteger(value))
    throw new Error(`Invalid calendar date: ${date}`);
  return value;
}
export function calendarKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
export function dayWidth(count: number): number {
  return count > 0 ? DAY_PADDING * 2 + count * ALBUM_WIDTH : EMPTY_DAY_WIDTH;
}
function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** O(nonempty days) memory. Empty calendar spans are implicit. */
export class PulseLayout {
  readonly first: number;
  readonly count: number;
  readonly maxAlbumMs: number;
  private readonly indices: number[];
  private readonly extras: number[];
  private readonly days: Map<number, PulseDayLayout>;
  constructor(
    readonly from: string,
    readonly to: string,
    entries: readonly PulseDayLayout[],
  ) {
    this.first = calendarDay(from);
    this.count = calendarDay(to) - this.first + 1;
    if (this.count < 1) throw new Error("Reversed calendar range");
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    this.indices = [];
    this.extras = [0];
    this.days = new Map();
    let maximum = 0;
    for (const entry of sorted) {
      const index = calendarDay(entry.date) - this.first;
      if (index < 0 || index >= this.count || entry.albumCount < 1) continue;
      if (this.days.has(index)) throw new Error("Duplicate day in layout");
      this.days.set(index, entry);
      this.indices.push(index);
      this.extras.push(
        this.extras.at(-1)! + dayWidth(entry.albumCount) - EMPTY_DAY_WIDTH,
      );
      maximum = Math.max(maximum, entry.maxAlbumMs);
    }
    this.maxAlbumMs = maximum;
  }
  date(index: number): string {
    return calendarKey(
      this.first + Math.max(0, Math.min(this.count - 1, index)),
    );
  }
  index(date: string): number {
    return Math.max(
      0,
      Math.min(this.count - 1, calendarDay(date) - this.first),
    );
  }
  day(index: number): PulseDayLayout | undefined {
    return this.days.get(index);
  }
  width(index: number): number {
    return dayWidth(this.days.get(index)?.albumCount ?? 0);
  }
  start(index: number): number {
    const clamped = Math.max(0, Math.min(this.count, index));
    return (
      clamped * EMPTY_DAY_WIDTH +
      this.extras[upperBound(this.indices, clamped - 1)]
    );
  }
  get totalWidth(): number {
    return this.start(this.count);
  }
  locate(pixel: number): { index: number; offset: number } {
    const target = Math.max(0, Math.min(this.totalWidth - 1, pixel));
    let lo = 0;
    let hi = this.count;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.start(mid) <= target) lo = mid;
      else hi = mid;
    }
    return { index: lo, offset: target - this.start(lo) };
  }
}
export function wheelDistance(
  deltaX: number,
  deltaY: number,
  mode: number,
  viewport: number,
): number {
  return (
    (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) *
    (mode === 1 ? 16 : mode === 2 ? viewport : 1)
  );
}

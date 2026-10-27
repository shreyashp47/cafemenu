/**
 * Time zones: the cafe's day, and what the settings carry for the rules.
 *
 * A cafe's day (its order numbers, its reports) starts at local midnight. The
 * app asks `Intl` where that is (`dayKeyIn`, `dayStartIn`), whatever zone the
 * phone or laptop itself is set to. firestore.rules cannot: the rules language
 * has no time zone database. So the settings carry the zone's two UTC offsets,
 * standard and daylight-saving, and the rules accept a day that matches either
 * (`dayKeysAt`; apps/cafe/docs/decisions.md, "Any time zone"). For a zone
 * without daylight saving, such as Asia/Kolkata, the two are the same and so is
 * the day.
 */

export interface UtcOffsets {
  /** Minutes east of UTC outside daylight saving: Asia/Kolkata is 330. */
  standard: number;
  /** Minutes east of UTC during daylight saving; equal to `standard` without it. */
  daylight: number;
}

/** UTC-12:00 to UTC+14:00, the range real zones use. */
export const MIN_UTC_OFFSET = -12 * 60;
export const MAX_UTC_OFFSET = 14 * 60;

/** True for an IANA zone name this runtime knows, such as "Asia/Kolkata". */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// One formatter per zone: building one costs far more than using it, and the
// history and reports pages ask for hundreds of dates at a time.
const wallFormats = new Map<string, Intl.DateTimeFormat>();

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The date and time a clock in `timeZone` shows at the instant `ms`. */
function wallClock(timeZone: string, ms: number): WallClock {
  let format = wallFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    wallFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const DAY_MS = 86_400_000;

/** Minutes east of UTC in `timeZone` at the instant `ms`. */
export function utcOffsetAt(timeZone: string, ms: number): number {
  // Reads the zone's wall clock back as if it were UTC; the difference is the
  // offset. This works on every engine, unlike the newer "longOffset" format.
  const w = wallClock(timeZone, ms);
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const minute = Math.floor(ms / 60_000) * 60_000;
  return Math.round((wall - minute) / 60_000);
}

/**
 * The zone's standard and daylight-saving offsets in `year`, from its offset at
 * noon UTC on every day of it, so a few weeks of daylight saving (or of its
 * suspension, as in Morocco for Ramadan) are not missed. The smaller is called
 * standard, which also holds in the southern hemisphere, where daylight saving
 * spans the new year.
 */
export function utcOffsetsOf(
  timeZone: string,
  year = new Date().getUTCFullYear(),
): UtcOffsets {
  const seen = new Set<number>();
  const end = Date.UTC(year + 1, 0, 1);
  for (let ms = Date.UTC(year, 0, 1, 12); ms < end; ms += DAY_MS) {
    seen.add(utcOffsetAt(timeZone, ms));
  }
  return { standard: Math.min(...seen), daylight: Math.max(...seen) };
}

// --- the cafe's day ---------------------------------------------------------

/**
 * The cafe day an instant belongs to, "YYYY-MM-DD": the date a clock in
 * `timeZone` shows at `ms`. Daily order numbers count within it, and reports
 * bucket by it. The device's own zone plays no part, so a laptop set to
 * another zone still files an order under the cafe's day.
 */
export function dayKeyIn(timeZone: string, ms: number): string {
  const w = wallClock(timeZone, ms);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** "YYYY-MM-DD HH:MM", the cafe's own date and time at `ms` (24-hour). */
export function wallTimeIn(timeZone: string, ms: number): string {
  const w = wallClock(timeZone, ms);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** The day `days` after `key` (before, when negative), by the calendar. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return keyOf(y, m - 1, d + days);
}

/** The first day of the month `months` after the one `key` is in. */
export function addMonths(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  return keyOf(y, m - 1 + months, 1);
}

/** "YYYY-MM-DD" for a calendar date, overflow carried: (2026, 12, 1) is 2027-01-01. */
function keyOf(year: number, month0: number, day: number): string {
  const date = new Date(midnightUtc(year, month0, day));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function midnightUtc(year: number, month0: number, day: number): number {
  const date = new Date(0);
  // Unlike Date.UTC, this does not read years 0-99 as 1900-1999.
  date.setUTCFullYear(year, month0, day);
  return date.getTime();
}

/**
 * The first instant of the day `key` in `timeZone`: local midnight, or, on the
 * rare day a daylight-saving jump skips midnight (America/Santiago, say), the
 * moment the clock jumps. A day is `[dayStartIn(key), dayStartIn(next))`,
 * which is 23 or 25 hours long on a change day; never add 24 hours instead.
 */
export function dayStartIn(timeZone: string, key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const midnight = midnightUtc(y, m - 1, d);
  // Wherever the zone is, its clock reads `key` 00:00 within this window: an
  // hour beyond the furthest offsets either way. Halve it down to the minute
  // (offsets and daylight-saving jumps are whole minutes), keeping `lo`
  // before the day and `hi` in it.
  let lo = midnight - (MAX_UTC_OFFSET + 60) * 60_000;
  let hi = midnight - (MIN_UTC_OFFSET - 60) * 60_000;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (dayKeyIn(timeZone, mid) < key) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The instant a clock in `timeZone` shows `wall`, "YYYY-MM-DD HH:MM" (what
 * wallTimeIn gives back): how a form that asks for a date and time in the
 * cafe's own zone gets a time to store, whatever zone the device is in. In
 * the hour a daylight-saving jump skips, the moment the clock jumps; in the
 * hour that repeats, the first of the two. Null when `wall` isn't one.
 */
export function instantIn(timeZone: string, wall: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(wall);
  if (!match) return null;
  const [y, m, d, hh, mm] = match.slice(1).map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const guess = midnightUtc(y, m - 1, d) + (hh * 60 + mm) * 60_000;
  if (wallTimeIn("UTC", guess) !== wall) return null; // 31 February
  // As in dayStartIn: the clock reads `wall` within this window wherever the
  // zone is. Keep `lo` before it and `hi` at or after it, to the minute.
  let lo = guess - (MAX_UTC_OFFSET + 60) * 60_000;
  let hi = guess - (MIN_UTC_OFFSET - 60) * 60_000;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (wallTimeIn(timeZone, mid) < wall) lo = mid;
    else hi = mid;
  }
  // A repeated hour (or half hour, on Lord Howe Island) shows `wall` twice;
  // the search may have found the second.
  for (const minutes of [60, 30]) {
    const earlier = hi - minutes * 60_000;
    if (wallTimeIn(timeZone, earlier) === wall) return earlier;
  }
  return hi;
}

/**
 * The day keys firestore.rules accepts for an order placed at `ms`, given the
 * zone's offsets from the settings: the UTC date of `ms` plus each offset. One
 * key for a zone without daylight saving; for one with it, the two differ each
 * night between midnight by one offset and by the other (an hour, or half an
 * hour on Lord Howe Island), and the rules take either (apps/cafe
 * docs/decisions.md, "Any time zone"). `dayKeyIn` is always one of them.
 */
export function dayKeysAt(ms: number, offsets: UtcOffsets): string[] {
  const at = (minutes: number) =>
    new Date(ms + minutes * 60_000).toISOString().slice(0, 10);
  return [...new Set([at(offsets.standard), at(offsets.daylight)])];
}

/** Whole minutes in range, with daylight at least standard and at most 2 h on. */
export function isUtcOffsets(value: unknown): value is UtcOffsets {
  if (!value || typeof value !== "object") return false;
  const { standard, daylight } = value as Record<string, unknown>;
  const inRange = (n: unknown): n is number =>
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= MIN_UTC_OFFSET &&
    n <= MAX_UTC_OFFSET;
  return (
    inRange(standard) &&
    inRange(daylight) &&
    daylight >= standard &&
    daylight - standard <= 120
  );
}

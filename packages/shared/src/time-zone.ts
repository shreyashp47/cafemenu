/**
 * Time zones, as far as the settings need them.
 *
 * A cafe's day (its order numbers, its reports) starts at local midnight. The
 * app can ask `Intl` where that is, but firestore.rules cannot: the rules
 * language has no time zone database. So the settings carry the zone's two UTC
 * offsets, standard and daylight-saving, and the rules accept a day that
 * matches either (PLAN.md, Phase 1). For a zone without daylight saving, such
 * as Asia/Kolkata, the two are the same.
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

/** Minutes east of UTC in `timeZone` at the instant `ms`. */
export function utcOffsetAt(timeZone: string, ms: number): number {
  // Reads the zone's wall clock back as if it were UTC; the difference is the
  // offset. This works on every engine, unlike the newer "longOffset" format.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  const minute = Math.floor(ms / 60_000) * 60_000;
  return Math.round((wall - minute) / 60_000);
}

/**
 * The zone's standard and daylight-saving offsets in `year`, from its offset on
 * the first of every month. The smaller is called standard, which also holds in
 * the southern hemisphere, where daylight saving spans the new year.
 */
export function utcOffsetsOf(
  timeZone: string,
  year = new Date().getUTCFullYear(),
): UtcOffsets {
  const seen: number[] = [];
  for (let month = 0; month < 12; month += 1) {
    seen.push(utcOffsetAt(timeZone, Date.UTC(year, month, 1, 12)));
  }
  return { standard: Math.min(...seen), daylight: Math.max(...seen) };
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

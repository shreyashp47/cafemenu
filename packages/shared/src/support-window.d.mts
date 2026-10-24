/** Types for support-window.mjs, which says how the support window works. */

export const SUPPORTED_LINES: 2;
export const NOTICE_DAYS: 30;

/** A release record, as far as the window needs it. */
export interface WindowRelease {
  /** "1.4.2". Anything that is not a stable release version is ignored. */
  version: string;
  /** Left out, or "stable", counts; "beta" does not. */
  channel?: string;
  withdrawn?: boolean;
  /** Milliseconds, a Date, a date string or a Firestore Timestamp. */
  publishedAt?: unknown;
}

export interface WindowOptions {
  supportedLines?: number;
  noticeDays?: number;
}

export interface SupportLine {
  line: string;
  /** When the line's first stable release came out (ms), or null if unknown. */
  firstPublishedAt: number | null;
}

export interface SupportWindow {
  supportedLines: number;
  noticeDays: number;
  /** Every line that has a stable release, newest first. */
  lines: SupportLine[];
  /** The lines that get fixes, newest first. */
  supported: string[];
}

export interface LineSupport {
  line: string;
  supported: boolean;
  droppedAt: number | null;
  upgradeBy: number | null;
  due: boolean;
  daysLeft: number | null;
}

export function toMillis(value: unknown): number | null;
export function stableLineOf(version: unknown): string | null;
export function isLine(text: unknown): text is string;
export function compareLines(a: string, b: string): number;
export function supportWindow(
  releases: readonly WindowRelease[] | null | undefined,
  options?: WindowOptions,
): SupportWindow;
export function lineSupport(
  window: SupportWindow,
  line: string,
  now: unknown,
): LineSupport;
export function supportNotice(
  release: { pinned?: string | null } | null | undefined,
  releases: readonly WindowRelease[] | null | undefined,
  now: unknown,
  options?: WindowOptions,
): LineSupport | null;

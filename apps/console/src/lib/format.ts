/**
 * Dates as the console shows them, in the console's own language (English
 * for now; a second language is a second messages file and a parameter
 * here). In the viewer's time zone unless one is given.
 */

const LANGUAGE = "en";

export function formatDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(LANGUAGE, {
    dateStyle: "medium",
    timeZone,
  }).format(ms);
}

export function formatDateTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(LANGUAGE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(ms);
}

/**
 * Every word the console shows lives in messages/en.json (house rule 6), so a
 * second language is a second file. The file is imported as typed JSON: a
 * missing key is a type error, not a blank on the page.
 *
 * Strings may carry three bits of inline markup, rendered by <Rich>:
 * **bold**, `code` and [a link](https://…). Nothing else is interpreted, and
 * nothing is ever inserted as HTML.
 */

import en from "../../messages/en.json";
import type { CafeProblem } from "./platform/validate";

export const messages = en;
export type Messages = typeof en;

/** The words for a validation problem from src/lib/platform/validate.ts. */
export function problemText(problem: CafeProblem): string {
  return messages.problems[problem];
}

/** The words for an error a repository threw, by its Firebase-style code. */
export function errorText(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const known = messages.errors as Record<string, string>;
  return known[code] ?? messages.errors.unknown;
}

export type RichPart =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

const MARKUP = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Only these become links; anything else stays as the text it was. */
const SAFE_HREF = /^(https:\/\/|http:\/\/localhost[:/]|\/|#)/;

/** Splits a message into plain text and its inline markup. */
export function parseRich(source: string): RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;
  for (const match of source.matchAll(MARKUP)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ kind: "text", text: source.slice(last, start) });
    }
    const [whole, strong, code, linkText, href] = match;
    if (strong !== undefined) parts.push({ kind: "strong", text: strong });
    else if (code !== undefined) parts.push({ kind: "code", text: code });
    else if (linkText !== undefined && href && SAFE_HREF.test(href)) {
      parts.push({ kind: "link", text: linkText, href });
    } else {
      parts.push({ kind: "text", text: whole });
    }
    last = start + whole.length;
  }
  if (last < source.length) {
    parts.push({ kind: "text", text: source.slice(last) });
  }
  return parts;
}

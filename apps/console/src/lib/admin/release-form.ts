/**
 * The admin's "publish a release" form (#30) as data: what a release record
 * needs, and what is wrong with it before the backend is asked to write it.
 * Pure, so every rule is tested without a browser; the words for each
 * problem are in messages/en.json under `admin.releases.problems`.
 *
 * The backend checks the release package itself (its manifest must say the
 * same version, channel and schema); these are only the mistakes that can be
 * seen from here.
 */

import {
  RELEASE_CHANNELS,
  type ReleaseChannel,
  type Release,
} from "../platform/model";
import { isReleaseChannel, isVersion } from "../platform/validate";
import type { PublishReleaseInput } from "../data/types";

/** Notes are Markdown in one Firestore document: far less than its limit. */
export const MAX_NOTES_LENGTH = 20_000;

export interface ReleaseForm {
  version: string;
  channel: ReleaseChannel;
  notes: string;
  /** As typed, so a half-typed number is not thrown away. */
  schemaVersion: string;
}

export type ReleaseProblem =
  | "version-format"
  | "version-taken"
  | "prerelease-stable"
  | "channel-unknown"
  | "notes-empty"
  | "notes-long"
  | "schema-invalid";

export type ReleaseField = "version" | "channel" | "notes" | "schemaVersion";

export type ReleaseProblems = Partial<Record<ReleaseField, ReleaseProblem>>;

/** In page order, so the first one can take the focus. */
export const RELEASE_FIELD_ORDER: readonly ReleaseField[] = [
  "version",
  "channel",
  "schemaVersion",
  "notes",
];

/** The highest schema any published release expects; 1 before any. */
export function latestSchema(releases: readonly Release[]): number {
  return releases.reduce((high, r) => Math.max(high, r.schemaVersion), 1);
}

/** A blank form: to beta first, on the schema the newest release expects. */
export function emptyReleaseForm(releases: readonly Release[]): ReleaseForm {
  return {
    version: "",
    channel: "beta",
    notes: "",
    schemaVersion: String(latestSchema(releases)),
  };
}

/** A whole number from 1, or null. */
export function schemaOf(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

/** "1.5.0-beta.1" has a pre-release part: it is not a stable release. */
export const isPrerelease = (version: string) => version.includes("-");

export function releaseFormProblems(
  form: ReleaseForm,
  /** The versions already published. */
  existing: readonly string[],
): ReleaseProblems {
  const problems: ReleaseProblems = {};
  const version = form.version.trim();
  if (!isVersion(version)) problems.version = "version-format";
  else if (existing.includes(version)) problems.version = "version-taken";
  if (!isReleaseChannel(form.channel)) problems.channel = "channel-unknown";
  else if (
    isVersion(version) &&
    isPrerelease(version) &&
    form.channel === "stable"
  ) {
    // A pre-release is never what a stable cafe is moved onto.
    problems.channel = "prerelease-stable";
  }
  if (schemaOf(form.schemaVersion) === null)
    problems.schemaVersion = "schema-invalid";
  const notes = form.notes.trim();
  if (!notes) problems.notes = "notes-empty";
  else if (notes.length > MAX_NOTES_LENGTH) problems.notes = "notes-long";
  return problems;
}

export const firstReleaseProblem = (
  problems: ReleaseProblems,
): ReleaseField | null =>
  RELEASE_FIELD_ORDER.find((field) => problems[field]) ?? null;

/** What the request carries. Assumes releaseFormProblems found nothing. */
export function releaseInputOf(form: ReleaseForm): PublishReleaseInput {
  return {
    version: form.version.trim(),
    channel: form.channel,
    notes: form.notes.trim(),
    schemaVersion: schemaOf(form.schemaVersion) ?? 1,
  };
}

/**
 * The same checks on a request, for whatever receives it (the demo
 * backend now, the real one later): codes, not sentences. A version that is
 * already published is the receiver's to know, not this function's.
 */
export function releaseInputProblems(input: PublishReleaseInput): string[] {
  const problems: string[] = [];
  if (!isVersion(input.version)) problems.push("version-format");
  if (!(RELEASE_CHANNELS as readonly unknown[]).includes(input.channel)) {
    problems.push("channel-unknown");
  } else if (
    isVersion(input.version) &&
    isPrerelease(input.version) &&
    input.channel === "stable"
  ) {
    problems.push("prerelease-stable");
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    problems.push("schema-invalid");
  }
  if (typeof input.notes !== "string" || !input.notes.trim()) {
    problems.push("notes-empty");
  } else if (input.notes.length > MAX_NOTES_LENGTH) {
    problems.push("notes-long");
  }
  return problems;
}

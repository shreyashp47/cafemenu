/**
 * The shape checks firestore.rules makes on a cafe, in TypeScript, so the
 * console can explain a problem instead of showing a refused write. The rules
 * stay the boundary; these only mirror them. Change both together.
 *
 * Checks return problem codes, not sentences: the words live in
 * messages/en.json under `problems`.
 */

import { validateCafeSettings, type CafeSettings } from "@cafemenu/shared";
import {
  CAFE_STATUSES,
  RELEASE_CHANNELS,
  type CafeStatus,
  type ReleaseChannel,
} from "./model";

/**
 * A Hosting site name becomes the subdomain of their-cafe.web.app, so it must
 * be a valid hostname label: lowercase letters, digits and hyphens, not
 * starting or ending with a hyphen, and at most 30 characters (Firebase's
 * limit for a site ID). Whether the name is still free is a separate check
 * against Firebase, made by the sign-up form.
 */
export const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/**
 * A Firebase project ID: 6 to 30 characters, lowercase letters, digits and
 * hyphens, starting with a letter and not ending with a hyphen.
 */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A release version: "1.4.2", or a pre-release such as "1.5.0-beta.1". */
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A minor line a cafe can stay on: "1.4". */
export const MINOR_LINE = /^\d+\.\d+$/;

/**
 * The plan a new cafe starts on. Afterwards `settings.plan` is the backend's
 * to change, never the owner's (issue #17): the rules refuse both.
 */
export const STARTING_PLAN = "free";

export const isSiteName = (value: unknown): value is string =>
  typeof value === "string" && SITE_NAME.test(value);

export const isProjectId = (value: unknown): value is string =>
  typeof value === "string" && PROJECT_ID.test(value);

export const isVersion = (value: unknown): value is string =>
  typeof value === "string" && VERSION.test(value);

export const isMinorLine = (value: unknown): value is string =>
  typeof value === "string" && MINOR_LINE.test(value);

export const isReleaseChannel = (value: unknown): value is ReleaseChannel =>
  (RELEASE_CHANNELS as readonly unknown[]).includes(value);

export const isCafeStatus = (value: unknown): value is CafeStatus =>
  (CAFE_STATUSES as readonly unknown[]).includes(value);

/** "1.4.2" → "1.4"; null for anything that is not a version. */
export function minorLineOf(version: string): string | null {
  if (!isVersion(version)) return null;
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
}

/** A plain object, as Firestore stores a map. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type CafeProblem =
  | "site-format"
  | "project-id-format"
  | "settings-invalid"
  | "plan-locked"
  | "channel-unknown"
  | "pinned-format";

export type SettingsResult =
  { ok: true; settings: CafeSettings } | { ok: false; problems: string[] };

/**
 * The strict check from @cafemenu/shared: every field present and valid,
 * nothing unknown, offsets that match the time zone. On success, the cleaned
 * settings (trimmed text, upper-case codes, sorted tables) to write.
 */
export function checkSettings(settings: unknown): SettingsResult {
  return validateCafeSettings(settings);
}

export interface ReleaseChoice {
  channel: ReleaseChannel;
  pinned: string | null;
}

export function releaseChoiceProblems(choice: ReleaseChoice): CafeProblem[] {
  const problems: CafeProblem[] = [];
  if (!isReleaseChannel(choice.channel)) problems.push("channel-unknown");
  if (choice.pinned !== null && !isMinorLine(choice.pinned)) {
    problems.push("pinned-format");
  }
  return problems;
}

/** What an owner sends to create a cafe. */
export interface NewCafeInput {
  site: string;
  /** Build it with newCafeSettings() from @cafemenu/shared. */
  settings: CafeSettings;
  /** Usually not known yet at sign-up: it comes at the access step. */
  projectId?: string | null;
  /** Defaults to stable, following new versions (no pin). */
  release?: Partial<ReleaseChoice>;
}

/** The release choice a new cafe starts with: stable, no pin. */
export function releaseChoiceOf(
  choice: Partial<ReleaseChoice> | undefined,
): ReleaseChoice {
  return {
    channel: choice?.channel ?? "stable",
    pinned: choice?.pinned ?? null,
  };
}

/**
 * Every problem with a new cafe at once, and the cleaned settings to write
 * when there is none.
 */
export function checkNewCafe(
  input: NewCafeInput,
):
  | { ok: true; settings: CafeSettings }
  | { ok: false; problems: CafeProblem[]; settingsProblems: string[] } {
  const problems: CafeProblem[] = [];
  if (!isSiteName(input.site)) problems.push("site-format");
  const projectId = input.projectId ?? null;
  if (projectId !== null && !isProjectId(projectId)) {
    problems.push("project-id-format");
  }
  const settings = checkSettings(input.settings);
  if (!settings.ok) problems.push("settings-invalid");
  else if (settings.settings.plan !== STARTING_PLAN) {
    problems.push("plan-locked");
  }
  problems.push(...releaseChoiceProblems(releaseChoiceOf(input.release)));
  if (problems.length || !settings.ok) {
    return {
      ok: false,
      problems,
      settingsProblems: settings.ok ? [] : settings.problems,
    };
  }
  return { ok: true, settings: settings.settings };
}

/**
 * Thrown by the repositories when a check above fails, before any write.
 * `settingsProblems` are @cafemenu/shared's own descriptions, one per field
 * ("name: must be text of 1 to 60 characters").
 */
export class CafeInputError extends Error {
  constructor(
    readonly problems: CafeProblem[],
    readonly settingsProblems: string[] = [],
  ) {
    super(`Invalid cafe: ${[...problems, ...settingsProblems].join(", ")}`);
    this.name = "CafeInputError";
  }
}

/**
 * The shape checks firestore.rules makes on a cafe, in TypeScript, so the
 * console can explain a problem instead of showing a refused write. The rules
 * stay the boundary; these only mirror them. Change both together.
 *
 * Checks return problem codes, not sentences: the words live in
 * messages/en.json under `problems`.
 */

import {
  MAX_IMPORT_ROWS,
  MENU_TEXT_LIMITS,
  STARTER_MENU_IDS,
  validateCafeSettings,
  type CafeSettings,
} from "@cafemenu/shared";
import { isFirestoreLocation } from "./locations";
import {
  CAFE_STATUSES,
  RELEASE_CHANNELS,
  SETUP_LOGO_MAX_BYTES,
  STARTING_MENU_SOURCES,
  type CafeStatus,
  type ReleaseChannel,
  type StartingMenu,
  type StartingMenuItem,
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

/**
 * The shape of a Firestore location ID, "nam5" or "asia-south1", as the rules
 * check it. The console offers only the ones in ./locations.ts.
 */
export const REGION_FORMAT =
  /^[a-z]{2,20}(?:[0-9]{1,2}|-[a-z]{2,20}[0-9]{1,2})$/;

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

export const isRegionFormat = (value: unknown): value is string =>
  typeof value === "string" && REGION_FORMAT.test(value);

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
  | "region-unknown"
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
  /** A location from ./locations.ts. */
  region: string;
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
  if (!isFirestoreLocation(input.region)) problems.push("region-unknown");
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

// -- what the owner gives at sign-up --------------------------------------------

export type SetupProblem =
  | "logo-not-png"
  | "logo-too-big"
  | "menu-source"
  | "menu-template"
  | "menu-currency"
  | "menu-empty"
  | "menu-too-long"
  | "menu-item";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * The checks the rules make on a stored logo, and one they cannot: that it
 * is a PNG at all. The deployer decodes it again before drawing icons.
 */
export function logoProblems(png: Uint8Array): SetupProblem[] {
  const problems: SetupProblem[] = [];
  const isPng =
    png.length > PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => png[i] === byte);
  if (!isPng) problems.push("logo-not-png");
  if (png.length > SETUP_LOGO_MAX_BYTES) problems.push("logo-too-big");
  return problems;
}

const textOf = (value: unknown, min: number, max: number) =>
  typeof value === "string" && value.length >= min && value.length <= max;

/** One row, against the limits of the cafe app's own menu import. */
export function isStartingMenuItem(item: unknown): item is StartingMenuItem {
  if (!isPlainObject(item)) return false;
  const keys = Object.keys(item).sort().join(",");
  return (
    keys === "available,category,description,name,price" &&
    textOf(item.name, 1, MENU_TEXT_LIMITS.name) &&
    textOf(item.category, 1, MENU_TEXT_LIMITS.category) &&
    textOf(item.description, 0, MENU_TEXT_LIMITS.description) &&
    typeof item.price === "number" &&
    Number.isSafeInteger(item.price) &&
    item.price > 0 &&
    typeof item.available === "boolean"
  );
}

/**
 * Every problem with a starting menu, for the cafe whose settings are
 * `settings`. The rules check all of this but the rows themselves, which they
 * can only count.
 */
export function startingMenuProblems(
  menu: StartingMenu,
  settings: Pick<CafeSettings, "currency">,
): SetupProblem[] {
  const problems: SetupProblem[] = [];
  if (!(STARTING_MENU_SOURCES as readonly string[]).includes(menu.source)) {
    problems.push("menu-source");
  }
  const template = menu.template;
  const templateOk =
    menu.source === "template"
      ? (STARTER_MENU_IDS as readonly (string | null)[]).includes(template)
      : template === null;
  if (!templateOk) problems.push("menu-template");
  if (menu.currency !== settings.currency) problems.push("menu-currency");
  const items: unknown[] = Array.isArray(menu.items) ? menu.items : [];
  if (menu.source === "blank" ? items.length > 0 : items.length === 0) {
    problems.push("menu-empty");
  }
  if (items.length > MAX_IMPORT_ROWS) problems.push("menu-too-long");
  if (!Array.isArray(menu.items) || !items.every(isStartingMenuItem)) {
    problems.push("menu-item");
  }
  return problems;
}

/** Thrown by the setup repository when a check above fails, before writing. */
export class SetupInputError extends Error {
  constructor(readonly problems: SetupProblem[]) {
    super(`Invalid setup: ${problems.join(", ")}`);
    this.name = "SetupInputError";
  }
}

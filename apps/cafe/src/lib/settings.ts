/**
 * The cafe's settings (name, tagline, tables, …; see @cafemenu/shared), as one
 * live value for the whole page.
 *
 * Three layers, merged field by field, the later winning:
 *
 *   1. the defaults: the demo cafe, "Mochi & Beans";
 *   2. site.json, fetched once at boot (src/lib/boot.ts): the deploy-time copy,
 *      so the first paint is already the cafe's own;
 *   3. Firestore config/site, live (pushed in by DataProvider): what the
 *      platform last saved.
 *
 * The result is kept on the device and painted straight away on the next
 * visit, before either file has answered, and it stands in for site.json when
 * that cannot be reached.
 *
 * Until something is known the snapshot is UNKNOWN_SETTINGS, whose name is
 * empty: a real cafe's header stays blank for a moment rather than flashing the
 * demo cafe's name.
 *
 * The money settings (`moneyUnit`, `maxOrderTotal`) also depend on where the
 * data is; see moneyFor below and docs/decisions.md, "Any currency".
 */

import {
  DEFAULT_SETTINGS,
  LEGACY_MAX_ORDER_TOTAL,
  defaultMaxOrderTotal,
  parseCafeSettings,
  type CafeSettings,
} from "@cafemenu/shared";

import { boot, peekBoot } from "./boot";

export const SETTINGS_KEY = "cafemenu.settings.v1";

export interface SettingsSnapshot {
  settings: CafeSettings;
  /** False until a layer has answered or the device had a copy. */
  ready: boolean;
}

export const UNKNOWN_SETTINGS: SettingsSnapshot = Object.freeze({
  settings: { ...DEFAULT_SETTINGS, name: "", tagline: "" },
  ready: false,
});

/** config/site as last read; null until it has been, `raw: null` when absent. */
let live: { raw: unknown } | null = null;
/** The device's copy: undefined until read, null when there is none. */
let kept: CafeSettings | null | undefined;
let snapshot: SettingsSnapshot = UNKNOWN_SETTINGS;
let snapshotKey = "";
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readKept(): CafeSettings | null {
  if (kept === undefined) {
    try {
      const raw = storage()?.getItem(SETTINGS_KEY);
      kept = raw ? parseCafeSettings(JSON.parse(raw)) : null;
    } catch {
      kept = null;
    }
  }
  return kept;
}

function keep(settings: CafeSettings) {
  kept = settings;
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked: the next visit waits for the network */
  }
}

/**
 * The settings' money, made to match the data the page will read:
 *
 *   - The demo store keeps minor units whatever the settings say (it seeds
 *     itself that way). A preview of a cafe still in whole units, TOE before
 *     #21, shows minor-unit data under its own settings, with its currency's
 *     default cap: what #21 will leave it with.
 *   - A real cafe with no config/site document: firestore.rules then cap an
 *     order at LEGACY_MAX_ORDER_TOTAL, so the page does too. With no site.json
 *     either, it is a project from before CafeMenu, TOE's whole rupees.
 */
function moneyFor(
  settings: CafeSettings,
  demo: boolean,
  noConfigSite: boolean,
  noSiteJson: boolean,
): CafeSettings {
  if (demo) {
    if (settings.moneyUnit === "minor") return settings;
    const minor = { ...settings, moneyUnit: "minor" as const };
    return { ...minor, maxOrderTotal: defaultMaxOrderTotal(minor) };
  }
  if (!noConfigSite) return settings;
  return noSiteJson
    ? parseCafeSettings({ schemaVersion: 1 }, settings)
    : { ...settings, maxOrderTotal: LEGACY_MAX_ORDER_TOTAL };
}

/**
 * The merged settings, and whether they came from the layers themselves (and
 * so are worth keeping on the device) or only from the device's own copy.
 */
function compute(): { next: SettingsSnapshot; fresh: boolean } {
  const started = peekBoot();
  const fromCopy = () => {
    const copy = readKept();
    return {
      next: copy ? { settings: copy, ready: true } : UNKNOWN_SETTINGS,
      fresh: false,
    };
  };
  if (!started) return fromCopy();

  const { site, backend } = started;
  const demo = backend.kind === "demo";
  // site.json when it came; the device's copy when it could not be fetched;
  // the defaults when it definitely is not there.
  const base =
    site.status === "ok"
      ? parseCafeSettings(site.value.settings)
      : site.status === "error"
        ? (readKept() ?? DEFAULT_SETTINGS)
        : DEFAULT_SETTINGS;

  if (live) {
    const settings = moneyFor(
      parseCafeSettings(live.raw, base),
      demo,
      live.raw === null,
      site.status !== "ok",
    );
    return { next: { settings, ready: true }, fresh: true };
  }
  // config/site has not answered yet. With site.json, or in demo mode (where
  // the defaults are the cafe), that is enough to paint. A real cafe without
  // a site.json waits for Firestore, showing the device's copy meanwhile.
  if (site.status === "ok" || demo) {
    const settings = moneyFor(base, demo, false, false);
    return { next: { settings, ready: true }, fresh: true };
  }
  return fromCopy();
}

function emit() {
  for (const listener of listeners) listener();
}

/** The current settings. The same object until something changes. */
export function getSettingsSnapshot(): SettingsSnapshot {
  const { next, fresh } = compute();
  const key = JSON.stringify(next);
  if (key !== snapshotKey) {
    snapshot = next;
    snapshotKey = key;
    if (fresh) keep(next.settings);
  }
  return snapshot;
}

/** What the static export renders: nothing known yet. */
export function getServerSettingsSnapshot(): SettingsSnapshot {
  return UNKNOWN_SETTINGS;
}

/** Listens for changes, and starts the boot if nobody has yet. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  if (!peekBoot()) void boot().then(emit);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * config/site as the backend reports it: the document's data, or null when
 * there is no such document. Called by DataProvider.
 */
export function setLiveSettings(raw: unknown): void {
  live = { raw: raw ?? null };
  emit();
}

/** Drops everything learned so far. For tests. */
export function resetSettings(): void {
  live = null;
  kept = undefined;
  snapshot = UNKNOWN_SETTINGS;
  snapshotKey = "";
  emit();
}

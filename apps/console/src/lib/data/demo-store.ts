/**
 * Demo storage: the whole platform database in one localStorage key, so the
 * console runs with no Firebase project, like the cafe app's demo mode.
 *
 * It is live across tabs (the `storage` event), and the demo repositories in
 * demo.ts apply the same checks as firestore.rules, so a page that works here
 * does not then fail on permissions against the real thing.
 *
 * Nothing in it is private or shared: it lives in this browser only.
 */

import type {
  AdminLogEntry,
  AdminReason,
  BackendRequest,
  Cafe,
  CafeStatus,
  Deployment,
  OwnerStatus,
  PlatformUser,
  Release,
  SentEmail,
} from "../platform/model";
import type { RolloutStatus } from "./types";
import {
  parseAdminLogEntry,
  parseCafe,
  parseDeployment,
  parseReason,
  parseRelease,
  parseRequest,
  parseSentEmail,
} from "../platform/parse";
import { isPlainObject } from "../platform/validate";
import { SEED_RELEASES } from "./demo-seed";

export const DEMO_STORAGE_KEY = "cafemenu-console.demo.v1";

export interface DemoAccount {
  uid: string;
  email: string;
  /** See passwordHash() below: not security, and never the password itself. */
  passwordHash: string;
  emailVerified: boolean;
  /** The platform admin's claim. Only demo.ts, for DEMO_ADMIN, sets it. */
  isAdmin?: boolean;
}

/**
 * What the admin changed about an account (#78): the demo's stand-in for
 * `owners/{uid}`'s status and Authentication's disabled flag. Accounts with
 * no entry are active.
 */
export interface DemoOwnerState {
  status: OwnerStatus;
  statusReason: AdminReason | null;
  statusChangedAt: number | null;
  /** Each suspended cafe's status before, for reactivate. */
  cafesBefore: Record<string, CafeStatus>;
}

/** An email the demo's backend "sent": recorded, never sent. */
export type DemoEmail = SentEmail & { cafeId: string };

export interface DemoState {
  accounts: DemoAccount[];
  /** The signed-in account's uid. Shared by every tab, as Firebase's is. */
  session: string | null;
  cafes: Cafe[];
  releases: Release[];
  deployments: Deployment[];
  /** The rollout of each version that has one (a stub for #32). */
  rollouts: Record<string, RolloutStatus>;
  /** The super admin's (#78): their requests, the log, the emails, statuses. */
  requests: BackendRequest[];
  adminLog: AdminLogEntry[];
  emails: DemoEmail[];
  owners: Record<string, DemoOwnerState>;
}

export function seedState(): DemoState {
  return {
    accounts: [],
    session: null,
    cafes: [],
    releases: SEED_RELEASES.map((r) => ({ ...r })),
    deployments: [],
    rollouts: {},
    requests: [],
    adminLog: [],
    emails: [],
    owners: {},
  };
}

/** Stable ids without pulling in a uuid dependency. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

/**
 * Not security: demo accounts protect nothing and never leave this browser.
 * Hashing only keeps a typed password out of localStorage, and still lets a
 * wrong one be refused, as Firebase would. FNV-1a, salted with the email.
 */
export function passwordHash(email: string, password: string): string {
  let hash = 0x811c9dc5;
  for (const ch of `${email.toLowerCase()}\u0000${password}`) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// --- storage plumbing ---------------------------------------------------------

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
      return null;
    }
    const probe = "__cafemenu_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    // Private mode or disabled storage: keep the state in memory instead.
    return null;
  }
}

let memoryState: DemoState | null = null;

function parseAccount(value: unknown): DemoAccount | null {
  if (!isPlainObject(value)) return null;
  const { uid, email, passwordHash: hash, emailVerified } = value;
  if (
    typeof uid !== "string" ||
    typeof email !== "string" ||
    typeof hash !== "string"
  ) {
    return null;
  }
  return {
    uid,
    email,
    passwordHash: hash,
    emailVerified: emailVerified === true,
    ...(value.isAdmin === true ? { isAdmin: true } : {}),
  };
}

const keep = <T>(list: unknown, parse: (v: unknown) => T | null): T[] =>
  Array.isArray(list)
    ? list.map(parse).filter((item): item is T => item !== null)
    : [];

const ROLLOUT_STATUSES: readonly unknown[] = ["running", "paused", "completed"];

function parseRollouts(value: unknown): Record<string, RolloutStatus> {
  const rollouts: Record<string, RolloutStatus> = {};
  if (!isPlainObject(value)) return rollouts;
  for (const [version, status] of Object.entries(value)) {
    if (ROLLOUT_STATUSES.includes(status)) {
      rollouts[version] = status as RolloutStatus;
    }
  }
  return rollouts;
}

const CAFE_STATUS_WORDS: readonly unknown[] = [
  "draft",
  "provisioning",
  "live",
  "failed",
  "disconnected",
  "suspended",
];

function parseOwners(value: unknown): Record<string, DemoOwnerState> {
  const owners: Record<string, DemoOwnerState> = {};
  if (!isPlainObject(value)) return owners;
  for (const [uid, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) continue;
    const before: Record<string, CafeStatus> = {};
    if (isPlainObject(entry.cafesBefore)) {
      for (const [id, status] of Object.entries(entry.cafesBefore)) {
        if (CAFE_STATUS_WORDS.includes(status)) {
          before[id] = status as CafeStatus;
        }
      }
    }
    owners[uid] = {
      status: entry.status === "suspended" ? "suspended" : "active",
      statusReason: parseReason(entry.statusReason),
      statusChangedAt:
        typeof entry.statusChangedAt === "number"
          ? entry.statusChangedAt
          : null,
      cafesBefore: before,
    };
  }
  return owners;
}

/** A stored state that does not parse is replaced by a fresh seed. */
export function parseState(raw: string | null): DemoState {
  if (!raw) return seedState();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isPlainObject(data)) return seedState();
    const accounts = keep(data.accounts, parseAccount);
    const session =
      typeof data.session === "string" &&
      accounts.some((a) => a.uid === data.session)
        ? data.session
        : null;
    const withId = (v: unknown) =>
      isPlainObject(v) && typeof v.id === "string" ? v : null;
    const releases = keep(data.releases, (v) =>
      isPlainObject(v) && typeof v.version === "string"
        ? parseRelease(v.version, v)
        : null,
    );
    return {
      accounts,
      session,
      cafes: keep(data.cafes, (v) => {
        const doc = withId(v);
        return doc ? parseCafe(doc.id as string, doc) : null;
      }),
      releases: releases.length ? releases : seedState().releases,
      deployments: keep(data.deployments, (v) => {
        const doc = withId(v);
        return doc ? parseDeployment(doc.id as string, doc) : null;
      }),
      rollouts: parseRollouts(data.rollouts),
      requests: keep(data.requests, (v) => {
        const doc = withId(v);
        return doc ? parseRequest(doc.id as string, doc) : null;
      }),
      adminLog: keep(data.adminLog, (v) => {
        const doc = withId(v);
        return doc ? parseAdminLogEntry(doc.id as string, doc) : null;
      }),
      emails: keep(data.emails, (v) => {
        const doc = withId(v);
        const email = doc ? parseSentEmail(doc.id as string, doc) : null;
        return email && typeof doc?.cafeId === "string"
          ? { ...email, cafeId: doc.cafeId }
          : null;
      }),
      owners: parseOwners(data.owners),
    };
  } catch {
    return seedState();
  }
}

export function load(): DemoState {
  const store = safeStorage();
  if (!store) {
    memoryState ??= seedState();
    return memoryState;
  }
  return parseState(store.getItem(DEMO_STORAGE_KEY));
}

const listeners = new Set<() => void>();
let listeningToOtherTabs = false;

function notify() {
  for (const listener of [...listeners]) listener();
}

function save(state: DemoState) {
  const store = safeStorage();
  if (store) store.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  else memoryState = state;
  notify();
}

/** Applies `change` to the state and saves it; returns what `change` returns. */
export function mutate<T>(change: (state: DemoState) => T): T {
  const state = load();
  const result = change(state);
  save(state);
  return result;
}

/** Runs `listener` after every change, in this tab or another. */
export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  if (!listeningToOtherTabs && typeof window !== "undefined") {
    listeningToOtherTabs = true;
    window.addEventListener("storage", (event) => {
      if (event.key === DEMO_STORAGE_KEY || event.key === null) notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The signed-in account as the console sees it. Only DEMO_ADMIN is admin. */
export function currentUser(state: DemoState): PlatformUser | null {
  const account = state.accounts.find((a) => a.uid === state.session);
  if (!account) return null;
  return {
    uid: account.uid,
    email: account.email,
    emailVerified: account.emailVerified,
    isAdmin: account.isAdmin === true,
  };
}

// --- the setup documents --------------------------------------------------------

/**
 * `cafes/{cafeId}/setup/{part}` in demo mode, one localStorage key each, so
 * a logo of a few hundred kilobytes is not parsed on every read of the main
 * state. demo.ts applies the rules' checks before writing them.
 */
export const DEMO_SETUP_PREFIX = `${DEMO_STORAGE_KEY}.setup.`;

const memorySetup = new Map<string, string>();
const setupKey = (cafeId: string, part: string) =>
  `${DEMO_SETUP_PREFIX}${cafeId}.${part}`;

export function loadSetup(cafeId: string, part: string): unknown {
  const key = setupKey(cafeId, part);
  const store = safeStorage();
  const raw = store ? store.getItem(key) : (memorySetup.get(key) ?? null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Saves a setup document, or deletes it when `value` is null. */
export function saveSetup(cafeId: string, part: string, value: unknown) {
  const key = setupKey(cafeId, part);
  const store = safeStorage();
  if (value === null) {
    if (store) store.removeItem(key);
    memorySetup.delete(key);
    return;
  }
  const raw = JSON.stringify(value);
  try {
    if (store) store.setItem(key, raw);
    else memorySetup.set(key, raw);
  } catch {
    // Storage full: keep it for this tab, as private mode would.
    memorySetup.set(key, raw);
  }
}

/** Forget everything. For tests, and a future "reset the demo" button. */
export function resetDemo() {
  memoryState = null;
  memorySetup.clear();
  const store = safeStorage();
  if (store) {
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    for (const key of keys) {
      if (key?.startsWith(DEMO_SETUP_PREFIX)) store.removeItem(key);
    }
  }
  save(seedState());
}

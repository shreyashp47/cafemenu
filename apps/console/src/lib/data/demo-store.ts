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
  Cafe,
  Deployment,
  PlatformUser,
  Release,
} from "../platform/model";
import { parseCafe, parseDeployment, parseRelease } from "../platform/parse";
import { isPlainObject } from "../platform/validate";
import { SEED_RELEASES } from "./demo-seed";

export const DEMO_STORAGE_KEY = "cafemenu-console.demo.v1";

export interface DemoAccount {
  uid: string;
  email: string;
  /** See passwordHash() below: not security, and never the password itself. */
  passwordHash: string;
  emailVerified: boolean;
}

export interface DemoState {
  accounts: DemoAccount[];
  /** The signed-in account's uid. Shared by every tab, as Firebase's is. */
  session: string | null;
  cafes: Cafe[];
  releases: Release[];
  deployments: Deployment[];
}

export function seedState(): DemoState {
  return {
    accounts: [],
    session: null,
    cafes: [],
    releases: SEED_RELEASES.map((r) => ({ ...r })),
    deployments: [],
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
  };
}

const keep = <T>(list: unknown, parse: (v: unknown) => T | null): T[] =>
  Array.isArray(list)
    ? list.map(parse).filter((item): item is T => item !== null)
    : [];

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

/** The signed-in account as the console sees it. Demo accounts are never admin. */
export function currentUser(state: DemoState): PlatformUser | null {
  const account = state.accounts.find((a) => a.uid === state.session);
  if (!account) return null;
  return {
    uid: account.uid,
    email: account.email,
    emailVerified: account.emailVerified,
    isAdmin: false,
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

/** Bytes to base64 and back, for the logo. In chunks: a logo is large. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

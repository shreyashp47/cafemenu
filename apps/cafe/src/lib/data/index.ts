/**
 * Turns the boot's decision (src/lib/boot.ts) into storage repositories.
 *
 * Demo mode is a *static* import (so a no-config visitor gets a tiny bundle with
 * no Firebase download at all). Firestore is behind a dynamic `import()` so the
 * SDK is only fetched — and only parsed — once the page has booted into a
 * Firebase project.
 */

import { boot } from "../boot";
import {
  demoAuthRepo,
  demoConfigRepo,
  demoMenuRepo,
  demoOrderRepo,
  demoSessionRepo,
  demoStaffRepo,
} from "./demo";
import type { DataBundle } from "./types";

export const demoBundle: DataBundle = {
  menu: demoMenuRepo,
  orders: demoOrderRepo,
  auth: demoAuthRepo,
  config: demoConfigRepo,
  sessions: demoSessionRepo,
  staff: demoStaffRepo,
  isDemo: true,
};

let firestoreModule: Promise<typeof import("./firestore")> | null = null;

function firestore() {
  firestoreModule ??= import("./firestore").catch((error: unknown) => {
    // A dropped chunk download must not stick: the retry has to fetch again.
    firestoreModule = null;
    throw error;
  });
  return firestoreModule;
}

/**
 * Starts downloading the Firebase SDK early, for a device that already knows
 * it belongs to a real cafe (it kept the config last time). Errors are left
 * for loadBundle to report.
 */
export function preloadFirestore(): void {
  firestore().catch(() => {});
}

/**
 * The repositories for whatever the page booted into: the demo store, or
 * Firestore for the project the boot found. Rejects for a cafe that could not
 * be reached, which DataProvider shows as its retry screen.
 */
export async function loadBundle(): Promise<DataBundle> {
  const { backend } = await boot();
  if (backend.kind === "demo") return demoBundle;
  if (backend.kind === "unreachable") {
    throw new Error("Can't reach the cafe right now. Check the connection.");
  }
  const m = await firestore();
  return {
    menu: m.firestoreMenuRepo,
    orders: m.firestoreOrderRepo,
    auth: m.firestoreAuthRepo,
    config: m.firestoreConfigRepo,
    sessions: m.firestoreSessionRepo,
    staff: m.firestoreStaffRepo,
    isDemo: false,
  };
}

export * from "./types";

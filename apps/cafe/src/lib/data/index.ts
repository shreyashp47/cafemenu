/**
 * Chooses the storage backend.
 *
 * Demo mode is a *static* import (so a no-config visitor gets a tiny bundle with
 * no Firebase download at all). Firestore is behind a dynamic `import()` so the
 * SDK is only fetched — and only parsed — when a Firebase project is actually
 * configured.
 */

import { isDemoMode } from "../config";
import {
  demoAuthRepo,
  demoConfigRepo,
  demoMenuRepo,
  demoOrderRepo,
  demoSessionRepo,
} from "./demo";
import type { DataBundle } from "./types";

export const demoBundle: DataBundle = {
  menu: demoMenuRepo,
  orders: demoOrderRepo,
  auth: demoAuthRepo,
  config: demoConfigRepo,
  sessions: demoSessionRepo,
  isDemo: true,
};

let firestoreBundle: Promise<DataBundle> | null = null;

export async function loadBundle(): Promise<DataBundle> {
  if (isDemoMode) return demoBundle;

  firestoreBundle ??= import("./firestore").then((m) => ({
    menu: m.firestoreMenuRepo,
    orders: m.firestoreOrderRepo,
    auth: m.firestoreAuthRepo,
    config: m.firestoreConfigRepo,
    sessions: m.firestoreSessionRepo,
    isDemo: false,
  }));

  return firestoreBundle;
}

export * from "./types";

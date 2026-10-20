"use client";

import { useSyncExternalStore } from "react";

import {
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  subscribeSettings,
  type SettingsSnapshot,
} from "@/lib/settings";

/**
 * The cafe's settings, live (src/lib/settings.ts). Works anywhere, inside a
 * DataProvider or not; inside one, config/site changes arrive without a
 * reload. Until anything is known the name and tagline are empty strings.
 */
export function useCafeSettings(): SettingsSnapshot {
  return useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getServerSettingsSnapshot,
  );
}

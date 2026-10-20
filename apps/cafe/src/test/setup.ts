import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { primeBoot } from "@/lib/boot";
import { resetSettings } from "@/lib/settings";

// Every page starts in demo mode, as `npm run dev` does: neither
// /__/firebase/init.json nor /site.json exists. Settled up front, so pages
// render straight away instead of fetching. src/lib/__tests__/boot.test.ts
// covers the boot itself.
primeBoot({ backend: { kind: "demo" }, site: { status: "missing" } });

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSettings();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// jsdom has no matchMedia; several components probe it for installability.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// The customer flow checks `navigator.onLine` before attempting a write.
Object.defineProperty(window.navigator, "onLine", {
  value: true,
  writable: true,
  configurable: true,
});

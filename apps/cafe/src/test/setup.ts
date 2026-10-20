import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
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

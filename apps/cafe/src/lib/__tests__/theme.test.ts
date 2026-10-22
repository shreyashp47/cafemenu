/**
 * The themes on the page (src/lib/theme.ts): globals.css says the same as
 * @cafemenu/shared, and the theme reaches <html> both before and after React.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COLOUR_TOKENS,
  THEMES,
  THEME_PRESETS,
  accentColours,
  type ThemeId,
} from "@cafemenu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_KEY,
  THEME_SCRIPT,
  applyPageTheme,
  pageTheme,
} from "@/lib/theme";

const CSS = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

/** The colour tokens one preset's block in globals.css sets. */
function cssColours(theme: ThemeId): Record<string, string> {
  const start = CSS.indexOf(`[data-theme="${theme}"] {`);
  expect(start).toBeGreaterThan(-1);
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const colours: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /^\s+--([a-z-]+):\s*(#[0-9a-f]{6})\b/gim,
  )) {
    colours[name!] = value!.toUpperCase();
  }
  return colours;
}

afterEach(() => {
  vi.unstubAllGlobals();
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("style");
  document.head.innerHTML = "";
  localStorage.clear();
});

describe("globals.css", () => {
  it.each(THEMES)(
    "sets every colour of %s exactly as @cafemenu/shared",
    (id) => {
      const colours = cssColours(id);
      expect(Object.keys(colours).sort()).toEqual([...COLOUR_TOKENS].sort());
      expect(colours).toEqual(THEME_PRESETS[id].colours);
    },
  );

  it("makes Cozy the default, for a page with no theme set", () => {
    expect(CSS).toMatch(/:root,\s*\[data-theme="cozy"\] \{/);
  });
});

function themeColorMeta(content = "#7A3E1D") {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = content;
  document.head.appendChild(meta);
  return meta;
}

describe("applyPageTheme", () => {
  it("sets the theme, the accent and the toolbar colour, and keeps a copy", () => {
    const meta = themeColorMeta();
    const theme = pageTheme({ theme: "bistro", accent: "#3A86FF" });
    applyPageTheme(theme);

    const root = document.documentElement;
    const { primary } = accentColours("bistro", "#3A86FF");
    expect(root.dataset.theme).toBe("bistro");
    expect(root.style.getPropertyValue("--primary")).toBe(primary);
    expect(meta.content).toBe(primary);
    expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toEqual(theme);

    // Dropping the accent takes its properties off again.
    applyPageTheme(pageTheme({ theme: "dark", accent: null }));
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(meta.content).toBe(THEME_PRESETS.dark.colours.cream);
  });

  it("reads an unknown theme as Cozy", () => {
    expect(pageTheme({ theme: "neon" as ThemeId, accent: null }).theme).toBe(
      "cozy",
    );
  });
});

describe("THEME_SCRIPT", () => {
  const run = () => new Function(THEME_SCRIPT)();

  it("paints the theme this device last saw, before React", () => {
    const meta = themeColorMeta();
    localStorage.setItem(
      THEME_KEY,
      JSON.stringify(pageTheme({ theme: "minimal", accent: "#1D4E7A" })),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    run();

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("minimal");
    expect(root.style.getPropertyValue("--primary")).toBe("#1D4E7A");
    expect(meta.content).toBe(THEME_PRESETS.minimal.colours.cream);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a copy it does not trust", () => {
    localStorage.setItem(
      THEME_KEY,
      JSON.stringify({
        theme: "neon",
        vars: { "--primary": "red;x" },
        themeColor: "#fff",
      }),
    );
    run();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    localStorage.setItem(
      THEME_KEY,
      JSON.stringify({
        theme: "dark",
        vars: { "--primary": "url(x)", "--ink": "#000000" },
      }),
    );
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("asks site.json for the theme on a first visit", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ theme: "dark", accent: "#123456" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    run();
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    expect(fetch).toHaveBeenCalledWith("/site.json", expect.anything());
  });

  it("never throws, even without storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(run).not.toThrow();
  });
});

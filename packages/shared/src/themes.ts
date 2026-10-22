/**
 * The theme presets (`settings.theme`) and a cafe's accent over them.
 *
 * The CSS for each preset lives in the cafe app (apps/cafe/src/app/globals.css,
 * one `[data-theme]` block per preset). The colours are here as well, as data,
 * because more than the stylesheet needs them: the manifest and the browser's
 * theme colour, the accent guard below, and the console's signup form, which
 * previews a theme before there is a cafe to show it on. A test in the cafe
 * app checks the two copies agree, and one here checks every pairing the app
 * uses passes WCAG AA.
 */

import {
  AA_TEXT,
  contrastRatio,
  fitContrast,
  minContrast,
  mix,
  parseHex,
  toHex,
} from "./colour.ts";
import { THEMES, type CafeSettings, type ThemeId } from "./settings.ts";

/** Every colour token a preset sets, by its CSS name (`--cream`, …). */
export const COLOUR_TOKENS = [
  "cream",
  "cream-soft",
  "tan",
  "tan-deep",
  "paper",
  "primary",
  "primary-soft",
  "primary-dark",
  "secondary",
  "secondary-deep",
  "highlight",
  "highlight-soft",
  "sage",
  "sage-deep",
  "sage-soft",
  "berry",
  "berry-deep",
  "ink",
  "body",
  "muted",
  "on-dark",
  "line",
  "line-soft",
  "ring",
] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];
export type Palette = Readonly<Record<ColourToken, string>>;

export interface ThemePreset {
  id: ThemeId;
  /** What the owner picks from: "Cozy". */
  name: string;
  description: string;
  /** Whether the page is light with dark text, or the other way round. */
  scheme: "light" | "dark";
  /** Mochi the mascot, the doodles and the paper wash. Cozy only. */
  decorated: boolean;
  /**
   * The browser's toolbar colour (`theme-color`) and the manifest's: the
   * accent, or the page background.
   */
  chrome: "accent" | "background";
  colours: Palette;
}

/**
 * TOE's palette, unchanged (apps/cafe/docs/anime-theme.md §2). Several of its
 * mid-tones fail WCAG AA as text, hence the "-deep" twins.
 */
const COZY: Palette = {
  cream: "#F2E4D3",
  "cream-soft": "#F8EFE3",
  tan: "#E8D3B5",
  "tan-deep": "#DCC09B",
  paper: "#FFFCF7",
  primary: "#7A3E1D",
  "primary-soft": "#9C5730",
  "primary-dark": "#5A2D14",
  secondary: "#C97B3D",
  "secondary-deep": "#9A5522",
  highlight: "#E8A93E",
  "highlight-soft": "#F5D08A",
  sage: "#6B8E5A",
  "sage-deep": "#3F5E33",
  "sage-soft": "#DFEAD6",
  berry: "#C0505B",
  "berry-deep": "#9C3540",
  ink: "#3E2418",
  body: "#4A4038",
  muted: "#7A6A5C",
  "on-dark": "#F8EFE3",
  line: "#DCC8A9",
  "line-soft": "#E6D6BD",
  ring: "#C97B3D",
};

/** White cards on a quiet grey, one deep slate accent. */
const MINIMAL: Palette = {
  cream: "#F3F4F2",
  "cream-soft": "#F8F9F7",
  tan: "#E6E8E5",
  "tan-deep": "#D5D8D4",
  paper: "#FFFFFF",
  primary: "#1F3B4D",
  "primary-soft": "#2E5268",
  "primary-dark": "#132733",
  secondary: "#7A6B5D",
  "secondary-deep": "#66584B",
  highlight: "#F2C14E",
  "highlight-soft": "#FBEFCC",
  sage: "#3E8A62",
  "sage-deep": "#256243",
  "sage-soft": "#E1F0E7",
  berry: "#C2383A",
  "berry-deep": "#9C2629",
  ink: "#15191C",
  body: "#2F3539",
  muted: "#5B6368",
  "on-dark": "#FFFFFF",
  line: "#D6D9D5",
  "line-soft": "#E4E6E3",
  ring: "#3A6EA0",
};

/** A late espresso bar: dark roast surfaces, caramel accent, warm light text. */
const DARK: Palette = {
  cream: "#16110E",
  "cream-soft": "#1C1612",
  tan: "#2B231D",
  "tan-deep": "#3A3027",
  paper: "#221B16",
  primary: "#E8B872",
  "primary-soft": "#F0CA93",
  "primary-dark": "#F6DDB6",
  secondary: "#CC8D5C",
  "secondary-deep": "#E0AA7F",
  highlight: "#6D4A1B",
  "highlight-soft": "#3A2B17",
  sage: "#7FAE73",
  "sage-deep": "#A8D19B",
  "sage-soft": "#1F2B1D",
  berry: "#EE7F7F",
  "berry-deep": "#F6A9A9",
  ink: "#F5ECDF",
  body: "#E3D7C8",
  muted: "#B3A595",
  "on-dark": "#1A120D",
  line: "#40352C",
  "line-soft": "#30271F",
  ring: "#E8B872",
};

/** Ivory paper, oxblood and brass, serif headings: a corner bistro. */
const BISTRO: Palette = {
  cream: "#F5F0E8",
  "cream-soft": "#FAF6F0",
  tan: "#EBE2D4",
  "tan-deep": "#DCCFBB",
  paper: "#FFFDF9",
  primary: "#6B1F2A",
  "primary-soft": "#883343",
  "primary-dark": "#4D131C",
  secondary: "#726D3A",
  "secondary-deep": "#615D2C",
  highlight: "#D8B25A",
  "highlight-soft": "#F2E5C2",
  sage: "#5F805A",
  "sage-deep": "#3D5A39",
  "sage-soft": "#E3EBDE",
  berry: "#B23838",
  "berry-deep": "#8C2424",
  ink: "#2B1B17",
  body: "#40332D",
  muted: "#6D6057",
  "on-dark": "#FBF6EE",
  line: "#DCD1C1",
  "line-soft": "#E8DFD2",
  ring: "#883343",
};

export const THEME_PRESETS: Readonly<Record<ThemeId, ThemePreset>> =
  Object.freeze({
    cozy: {
      id: "cozy",
      name: "Cozy",
      description:
        "Warm cream and roasted brown, hand-lettered headings, and Mochi the barista. TOE's own look.",
      scheme: "light",
      decorated: true,
      chrome: "accent",
      colours: COZY,
    },
    minimal: {
      id: "minimal",
      name: "Minimal",
      description:
        "White cards on quiet grey, one clean typeface, nothing but the menu.",
      scheme: "light",
      decorated: false,
      chrome: "background",
      colours: MINIMAL,
    },
    dark: {
      id: "dark",
      name: "Dark",
      description:
        "Dark roast surfaces with a caramel accent. Easy on the eyes in a dim room.",
      scheme: "dark",
      decorated: false,
      chrome: "background",
      colours: DARK,
    },
    bistro: {
      id: "bistro",
      name: "Bistro",
      description:
        "Ivory paper, oxblood and brass, with serif headings like a printed menu.",
      scheme: "light",
      decorated: false,
      chrome: "accent",
      colours: BISTRO,
    },
  });

/** The preset for `theme`, Cozy for anything unknown. */
export function themePreset(theme: string | null | undefined): ThemePreset {
  return (THEMES as readonly string[]).includes(theme ?? "")
    ? THEME_PRESETS[theme as ThemeId]
    : THEME_PRESETS.cozy;
}

// --- the accent ---------------------------------------------------------------

/**
 * What the accent has to stay readable against: the surfaces it is used on
 * as text, and the text that sits on it when it fills a button.
 */
function accentAgainst(preset: ThemePreset): string[] {
  const c = preset.colours;
  return [c.paper, c.cream, c["cream-soft"], c["highlight-soft"], c["on-dark"]];
}

/** Which way an accent moves to gain contrast on this preset. */
function towardOf(preset: ThemePreset): string {
  return preset.scheme === "dark" ? "#FFFFFF" : "#000000";
}

export interface AccentColours {
  /** `--primary`: buttons, links, the cafe's name. */
  primary: string;
  /** `--primary-soft`: a pressed or hovered button, still under its text. */
  "primary-soft": string;
  /** `--primary-dark`: the stronger twin, for text on tinted pills. */
  "primary-dark": string;
  /** True when the colour asked for was moved to pass WCAG AA. */
  adjusted: boolean;
}

/**
 * The accent tokens for `accent` on `theme`: the preset's own when `accent`
 * is null or not a colour. A colour that fails WCAG AA against the preset is
 * darkened (lightened, on a dark preset) just enough to pass, the way TOE's
 * "-deep" tokens were made by hand.
 */
export function accentColours(
  theme: string | null | undefined,
  accent: string | null | undefined,
): AccentColours {
  const preset = themePreset(theme);
  const own = preset.colours;
  const rgb = accent ? parseHex(accent) : null;
  if (!rgb) {
    return {
      primary: own.primary,
      "primary-soft": own["primary-soft"],
      "primary-dark": own["primary-dark"],
      adjusted: false,
    };
  }
  const toward = towardOf(preset);
  const asked = toHex(rgb);
  // Always succeeds: the presets' surfaces and on-accent text all pass
  // against pure black (white, on a dark preset), which a test checks.
  const primary =
    fitContrast(asked, accentAgainst(preset), { toward }) ?? asked;
  // Like the presets' own: "-soft" is a little lighter (and brought back if
  // that loses its text), "-dark" moves further the way that gains contrast.
  const soft = mix(primary, "#FFFFFF", 0.16);
  return {
    primary,
    "primary-soft": fitContrast(soft, [own["on-dark"]], { toward }) ?? primary,
    "primary-dark": mix(
      primary,
      toward,
      preset.scheme === "dark" ? 0.45 : 0.28,
    ),
    adjusted: primary !== asked,
  };
}

export type AccentCheck =
  | { ok: true; accent: string; contrast: number }
  | {
      ok: false;
      /** The lowest contrast the colour has against the theme. */
      contrast: number;
      /** The nearest colour that passes, to offer instead. */
      suggestion: string;
      problem: string;
    };

/**
 * The strict check, for a form that asks for an accent (the console's signup
 * and branding screens): does `accent` pass WCAG AA on `theme` as it is? When
 * it does not, says why and offers the colour the app would use instead.
 */
export function checkAccent(theme: string, accent: string): AccentCheck {
  const preset = themePreset(theme);
  const rgb = parseHex(accent);
  if (!rgb) {
    return {
      ok: false,
      contrast: 1,
      suggestion: preset.colours.primary,
      problem: 'not a colour: use one like "#7A3E1D"',
    };
  }
  const asked = toHex(rgb);
  const contrast = minContrast(asked, accentAgainst(preset));
  if (contrast >= AA_TEXT) return { ok: true, accent: asked, contrast };
  const { primary } = accentColours(preset.id, asked);
  return {
    ok: false,
    contrast,
    suggestion: primary,
    problem: `${asked} is ${contrast.toFixed(1)}:1 against the ${preset.name} theme, and text needs ${AA_TEXT}:1. ${preset.scheme === "dark" ? "A lighter" : "A darker"} shade such as ${primary} passes.`,
  };
}

// --- what the page and the manifest use ---------------------------------------

/**
 * The CSS custom properties a cafe's settings put on the page over its
 * preset's stylesheet: the accent tokens, or nothing when the cafe uses the
 * preset's own.
 */
export function themeVariables(
  settings: Pick<CafeSettings, "theme" | "accent">,
): Record<string, string> {
  if (!settings.accent) return {};
  const colours = accentColours(settings.theme, settings.accent);
  return {
    "--primary": colours.primary,
    "--primary-soft": colours["primary-soft"],
    "--primary-dark": colours["primary-dark"],
  };
}

/** `theme-color` and the manifest's colours for a cafe. */
export function themeColours(
  settings: Pick<CafeSettings, "theme" | "accent">,
): {
  background: string;
  theme: string;
} {
  const preset = themePreset(settings.theme);
  const background = preset.colours.cream;
  return {
    background,
    theme:
      preset.chrome === "accent"
        ? accentColours(preset.id, settings.accent).primary
        : background,
  };
}

/** Each preset's own page and browser-chrome colours. */
export const THEME_COLOURS: Readonly<
  Record<ThemeId, { background: string; theme: string }>
> = Object.freeze(
  Object.fromEntries(
    THEMES.map((id) => [id, themeColours({ theme: id, accent: null })]),
  ) as Record<ThemeId, { background: string; theme: string }>,
);

/** Contrast between two tokens of a preset, for tests and the docs. */
export function tokenContrast(
  theme: ThemeId,
  a: ColourToken,
  b: ColourToken,
): number {
  const c = THEME_PRESETS[theme].colours;
  return contrastRatio(c[a], c[b]);
}

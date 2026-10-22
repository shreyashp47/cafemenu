/**
 * The cafe's theme on the page: `<html data-theme="…">` picks a token set in
 * globals.css, the cafe's accent goes on as inline custom properties over it,
 * and `<meta name="theme-color">` follows (docs/anime-theme.md §1).
 *
 * One build serves every cafe, so the static HTML has no theme in it. Two
 * things keep a Dark cafe from flashing Cozy's cream first:
 *
 *   - THEME_SCRIPT, inline in <head>, paints the theme this device last saw
 *     before the first frame; on a first visit it asks site.json for the
 *     theme (not the accent: the contrast maths stays out of the inline
 *     script) and usually has it before the stylesheet has finished;
 *   - <CafeTheme> applies the full theme once the settings are known, and
 *     keeps the copy that script reads.
 */

import {
  THEMES,
  themeColours,
  themePreset,
  themeVariables,
  type CafeSettings,
  type ThemeId,
} from "@cafemenu/shared";

export const THEME_KEY = "cafemenu.theme.v1";

/** The properties an accent sets; any not in a theme's `vars` are removed. */
const ACCENT_VARS = ["--primary", "--primary-soft", "--primary-dark"];

export interface PageTheme {
  theme: ThemeId;
  vars: Record<string, string>;
  themeColor: string;
}

export function pageTheme(
  settings: Pick<CafeSettings, "theme" | "accent">,
): PageTheme {
  return {
    theme: themePreset(settings.theme).id,
    vars: themeVariables(settings),
    themeColor: themeColours(settings).theme,
  };
}

export function applyPageTheme(theme: PageTheme, doc: Document = document) {
  const root = doc.documentElement;
  root.dataset.theme = theme.theme;
  for (const name of ACCENT_VARS) {
    const value = theme.vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.themeColor);
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  } catch {
    /* private mode: the next visit asks site.json again */
  }
}

/**
 * Runs before the first paint. Plain ES5 in a string, every value checked,
 * and never throws: at worst the page starts as Cozy and <CafeTheme> fixes it.
 */
export const THEME_SCRIPT = `(function(){try{
var d=document.documentElement,T=${JSON.stringify(THEMES)},H=/^#[0-9A-Fa-f]{6}$/;
function set(t){if(!t||T.indexOf(t.theme)<0)return;d.setAttribute("data-theme",t.theme);
var v=t.vars||{};for(var n in v)if(${JSON.stringify(ACCENT_VARS)}.indexOf(n)>=0&&H.test(v[n]))d.style.setProperty(n,v[n]);
var m=document.querySelector('meta[name="theme-color"]');if(m&&H.test(t.themeColor))m.setAttribute("content",t.themeColor);}
var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(s){set(JSON.parse(s));return;}
fetch("/site.json",{cache:"no-cache",credentials:"same-origin"}).then(function(r){
return r.ok&&!/html/.test(r.headers.get("content-type")||"")?r.json():null;
}).then(function(j){if(j&&!d.hasAttribute("data-theme"))set({theme:j.theme});}).catch(function(){});
}catch(e){}})();`;

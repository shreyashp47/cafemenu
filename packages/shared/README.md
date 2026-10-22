# @cafemenu/shared

Types and pure helpers that more than one part of CafeMenu needs to agree on:
the cafe app (`apps/cafe`), the console and the deployer. No dependencies, no
build step: TypeScript source, consumed as is by the cafe app (Next.js
`transpilePackages`) and by Vitest.

```ts
import {
  DEFAULT_SETTINGS,
  mergeCafeSettings,
  validateCafeSettings,
  type CafeSettings,
} from "@cafemenu/shared";
```

## Cafe settings

`CafeSettings` ([`src/settings.ts`](./src/settings.ts)) is everything that makes
one cafe's site its own:

| Field           | Example                                  | Notes                                                      |
| --------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `schemaVersion` | `1`                                      | `SETTINGS_SCHEMA_VERSION` when written                     |
| `name`          | `"TOE Cafe"`                             | 1–60 characters                                            |
| `tagline`       | `"Good Coffee, Better Days"`             | 0–80 characters                                            |
| `theme`         | `"cozy"`                                 | one of `THEMES`: `cozy`, `minimal`, `dark`, `bistro`       |
| `accent`        | `"#7A3E1D"` or `null`                    | over the theme's own accent                                |
| `logo`          | `"/logo.png"`, an https URL, or `null`   | `null` keeps the theme's artwork                           |
| `currency`      | `"INR"`                                  | ISO 4217                                                   |
| `locale`        | `"en-IN"`                                | BCP 47                                                     |
| `timeZone`      | `"Asia/Kolkata"`                         | IANA                                                       |
| `utcOffsets`    | `{ "standard": 330, "daylight": 330 }`   | minutes east of UTC, for `firestore.rules`                 |
| `tables`        | `[1, 2, 3, 4, 5, 6]`                     | default table list, 1–50, until the owner saves one        |
| `baseUrl`       | `"https://their-cafe.web.app"` or `null` | origin printed on QR cards; `null` uses the page's address |
| `plan`          | `"free"`                                 | one of `PLANS`                                             |

`DEFAULT_SETTINGS` is the demo cafe, "Mochi & Beans".

The same shape lives in three places, read in this order with the later
winning field by field:

1. `DEFAULT_SETTINGS`;
2. **`site.json`**, written next to the app bundle at every deploy, so the first
   paint is already the cafe's. It may also carry `"demo": true`, which makes
   the app run on its in-browser demo store with these settings (a preview
   deploy). See [`src/site-file.ts`](./src/site-file.ts);
3. **Firestore `config/site`**, the live copy. Anyone may read it; no client may
   write it. The platform writes it with its service account, which bypasses
   the rules.

Two ways to read them:

- **`parseCafeSettings(raw, base?)`** and **`mergeCafeSettings(...layers)`**:
  lenient, for readers. Every valid field of `raw` replaces the base's;
  anything missing or invalid keeps the base's value. Never throws. A layer that
  changes the time zone without giving its offsets gets them worked out.
- **`validateCafeSettings(raw)`**: strict, for writers (the console, the
  deployer). Every field present and valid, no unknown fields, the current
  schema version, offsets that match the time zone. Returns the cleaned
  settings or every problem by name. `validateSiteFile` does the same for a
  whole `site.json`, and `siteFileFor(settings, { demo })` builds one.

`newCafeSettings(fields)` fills in the defaults and the zone's offsets for a new
cafe.

## Plans and features

`features(settings)` ([`src/features.ts`](./src/features.ts)) says what a cafe's
plan includes, and `PLAN_FEATURES` is the table behind it. CafeMenu is free for
now, so the only plan, `free`, includes every feature; asking for features
anyway means a paid plan later is a new row, not a rework (issue #17). The
cafe app asks through `useFeatures()`; the CSV download on its reports page is
the first feature behind it. A plan a release does not know gets the free
plan's features. Features decide what the app shows; anything that must be
enforced also needs `firestore.rules`.

## Themes and the accent

`THEME_PRESETS` ([`src/themes.ts`](./src/themes.ts)) holds the four presets
(`cozy`, `minimal`, `dark`, `bistro`): name, description, whether they are
light or dark, and every colour token. The cafe app's `globals.css` has the
same colours as CSS, and a test there keeps the two equal.

- `accentColours(theme, accent)` gives the `--primary` tokens for a cafe's
  accent: the colour itself when it passes WCAG AA on the theme, or the nearest
  shade that does (darker on a light theme, lighter on Dark), keeping its hue.
- `checkAccent(theme, accent)` is the strict version for a form: it says
  whether the colour passes as it is and, when it does not, why, and which
  colour the app would use instead.
- `themeVariables(settings)` is the CSS custom properties the page sets, and
  `themeColours(settings)` the toolbar and manifest colours.
- `contrastRatio`, `fitContrast`, `mix` and friends
  ([`src/colour.ts`](./src/colour.ts)) are the WCAG maths underneath.

`monogramOf(name)` ([`src/monogram.ts`](./src/monogram.ts)) is the one or two
letters that stand in for a missing logo: "Mochi & Beans" → "MB".

## App icons

`@cafemenu/shared/icons` is a separate entry point, so the cafe app never
bundles it. `appIcons(settings, { logo, zlib })` makes every icon a cafe's site
serves (`ICON_PATHS`: 192 and 512 "any", a 512 maskable, the 180
`apple-touch-icon`, `favicon.ico` with 16, 32 and 48, and `icon.svg`) from its
logo as PNG bytes, or from its monogram in its accent without one.
`siteLogo(logo, zlib)` shrinks the logo the site itself serves. The deployer
writes both:

```js
import zlib from "node:zlib";
import { appIcons, siteLogo } from "@cafemenu/shared/icons";

for (const file of [
  ...appIcons(settings, { logo, zlib }),
  siteLogo(logo, zlib),
]) {
  await writeFile(join(siteDir, file.path), file.bytes);
}
```

It has no dependencies: the PNG reader and writer, the drawing and the
monogram's letters are in [`src/icons/`](./src/icons/), and compression is
`node:zlib`, passed in. Logos must be PNG (any colour type, bit depth or
interlacing, up to 4096 pixels a side); the console converts uploads before
storing them. A logo that cannot be read throws a `PngError` rather than
falling back to the monogram.

## The web app manifest

A static export fixes `manifest.webmanifest` at build time, and one build serves
every cafe, so the deployer writes each cafe's own with
`webManifest(settings)` ([`src/manifest.ts`](./src/manifest.ts)), its colours
from the cafe's theme and accent. The cafe app's build uses the same function
for the demo cafe, so the two never drift.

## Time zones

A cafe's day (its order numbers, its reports) runs from local midnight to local
midnight in its `timeZone`, whatever zone a device is set to
([`src/time-zone.ts`](./src/time-zone.ts)):

- `dayKeyIn(timeZone, ms)` is the cafe's date at an instant, `"2026-09-28"`:
  the day an order's number counts in, and the report bucket it goes in.
- `dayStartIn(timeZone, key)` is the first instant of that day. A day is
  `[dayStartIn(key), dayStartIn(addDays(key, 1)))`, 23 or 25 hours on a
  daylight-saving change day. `addDays` and `addMonths` count on keys.
- `wallTimeIn(timeZone, ms)` is `"2026-09-28 23:59"`, for the orders CSV.
- `utcOffsetsOf(timeZone, year?)` gives a zone's standard and daylight-saving
  offsets in minutes, which is what the settings store for `firestore.rules`
  (they cannot look a zone up). The rules accept a day that matches either
  offset; `dayKeysAt(ms, offsets)` does the same sums, and `dayKeyIn` is always
  one of its answers. `isTimeZone`, `utcOffsetAt` and `isUtcOffsets` are the
  pieces.

## Working on it

```bash
npm run verify -w @cafemenu/shared    # typecheck, tests, formatting
```

Only erasable TypeScript (no enums, no namespaces) and explicit `.ts`
extensions on relative imports, so a Node that strips types (22.18+) can import
the source directly. Node 20, which the repository still pins, cannot: a Node
script there reads these through the cafe app's build or a bundler.

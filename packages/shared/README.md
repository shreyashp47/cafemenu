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
| `theme`         | `"cozy"`                                 | one of `THEMES`                                            |
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

## The web app manifest

A static export fixes `manifest.webmanifest` at build time, and one build serves
every cafe, so the deployer writes each cafe's own with
`webManifest(settings)` ([`src/manifest.ts`](./src/manifest.ts)). The cafe app's
build uses the same function for the demo cafe, so the two never drift.

## Time zones

`utcOffsetsOf(timeZone, year?)` gives a zone's standard and daylight-saving
offsets in minutes, which is what the settings store for the rules (they cannot
look a zone up). `isTimeZone`, `utcOffsetAt` and `isUtcOffsets` are the pieces.

## Working on it

```bash
npm run verify -w @cafemenu/shared    # typecheck, tests, formatting
```

Only erasable TypeScript (no enums, no namespaces) and explicit `.ts`
extensions on relative imports, so a Node that strips types (22.18+) can import
the source directly. Node 20, which the repository still pins, cannot: a Node
script there reads these through the cafe app's build or a bundler.

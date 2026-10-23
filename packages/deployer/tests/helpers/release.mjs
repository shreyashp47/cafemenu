/**
 * Release packages, cafe settings and a stand-in for @cafemenu/shared, for
 * the release commands' tests.
 *
 * Packages are built by scripts/release/package.mjs itself, so they are
 * exactly what a real release publishes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildPackage } from "../../../../scripts/release/package.mjs";
import { createJsonDeployLog } from "../../src/deploy-log.mjs";
import { assetUrls } from "../../src/release-package.mjs";
import { context, tempDir, writeTree } from "./setup.mjs";

export const SITE = "lantern-cafe";
export const SHA = "0123456789abcdef0123456789abcdef01234567";

export const rulesFor = (version) => `rules_version = '2';
// CafeMenu ${version}
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
`;

const INDEXES = JSON.stringify({
  indexes: [
    {
      collectionGroup: "orders",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    },
  ],
  fieldOverrides: [],
});

const FIREBASE_JSON = JSON.stringify({
  hosting: {
    public: "out",
    ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
    cleanUrls: true,
    headers: [
      {
        source: "**",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ],
  },
});

/** The demo cafe's files a build ships, which every deploy replaces. */
export const DEMO_FILES = {
  "manifest.webmanifest": '{"name":"Mochi & Beans"}',
  "icon.svg": "<svg>demo</svg>",
  "icon-192.png": "demo 192",
  "icon-512.png": "demo 512",
  "icon-maskable-512.png": "demo maskable",
  "apple-touch-icon.png": "demo apple",
  "favicon.ico": "demo favicon",
};

/** A migration to schema `n` that changes nothing. */
export const noOpMigration = (n) => `export const from = ${n - 1};
export const to = ${n};
export const describe = "step ${n}";
export async function up() {}
`;

/**
 * Builds cafemenu-cafe-<version>.tar.gz and SHA256SUMS in a folder of their
 * own. Returns buildPackage's {archivePath, sumsPath, sha256, manifest}.
 */
export async function releasePackage(
  version,
  {
    schemaVersion = 1,
    minSchemaVersion = 1,
    site = {},
    migrations: sources = {},
  } = {},
) {
  const dir = await tempDir();
  const migrations = {};
  for (let n = 2; n <= schemaVersion; n += 1)
    migrations[`migrations/${String(n).padStart(4, "0")}-step.mjs`] =
      sources[n] ?? noOpMigration(n);
  await writeTree(dir, {
    "out/index.html": `<h1>Menu</h1><!-- ${version} -->`,
    "out/sw.js": `const VERSION = "${version}";`,
    "out/_next/static/app.js": `console.log("${version}")`,
    "out/_next/static/shared.js": "console.log('same in every release')",
    ...Object.fromEntries(
      Object.entries({ ...DEMO_FILES, ...site }).map(([p, c]) => [
        `out/${p}`,
        c,
      ]),
    ),
    "firestore.rules": rulesFor(version),
    "firestore.indexes.json": INDEXES,
    "firebase.json": FIREBASE_JSON,
    "migrations/schema.json": JSON.stringify({
      schemaVersion,
      minSchemaVersion,
    }),
    ...migrations,
    "CHANGELOG.md": "# Changelog\n",
  });
  return buildPackage({
    version,
    site: join(dir, "out"),
    rules: join(dir, "firestore.rules"),
    indexes: join(dir, "firestore.indexes.json"),
    hosting: join(dir, "firebase.json"),
    migrations: join(dir, "migrations"),
    changelog: join(dir, "CHANGELOG.md"),
    out: join(dir, "dist"),
    gitSha: SHA,
    createdAt: "2026-10-20T07:17:07Z",
  });
}

/** Publishes a built package on the fake GitHub, as the release workflow would. */
export async function publish(google, pkg) {
  const urls = assetUrls(pkg.manifest.version);
  google.state.github.set(urls.archive, await readFile(pkg.archivePath));
  google.state.github.set(urls.sums, await readFile(pkg.sumsPath));
}

/** A valid CafeSettings, as the console keeps them. */
export const SETTINGS = Object.freeze({
  schemaVersion: 2,
  name: "Lantern Cafe",
  tagline: "Tea by the river",
  theme: "cozy",
  accent: null,
  logo: null,
  currency: "INR",
  locale: "en-IN",
  moneyUnit: "minor",
  maxOrderTotal: 1000000,
  timeZone: "Asia/Kolkata",
  utcOffsets: { standard: 330, daylight: 330 },
  tables: [1, 2, 3],
  baseUrl: null,
  plan: "free",
});

/** The smallest PNG signature the stand-in accepts as a logo. */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("logo pixels"),
]);

export const ICON_PATHS = Object.freeze({
  svg: "/icon.svg",
  any192: "/icon-192.png",
  any512: "/icon-512.png",
  maskable: "/icon-maskable-512.png",
  apple: "/apple-touch-icon.png",
  favicon: "/favicon.ico",
});

/**
 * Stands in for @cafemenu/shared under Node 20, which can't import its
 * TypeScript: the same functions with the same shapes, much simpler bodies.
 * release.test.mjs also runs the real one on a Node that can.
 */
export const fakeShared = Object.freeze({
  SETTINGS_KEYS: Object.keys(SETTINGS),
  ICON_PATHS,
  validateCafeSettings(raw) {
    const problems = [
      ...Object.keys(SETTINGS)
        .filter((key) => !(key in raw))
        .map((key) => `${key}: missing`),
      ...Object.keys(raw)
        .filter((key) => !(key in SETTINGS))
        .map((key) => `${key}: not a setting`),
    ];
    if (typeof raw.name !== "string" || !raw.name)
      problems.push("name: must be 1 to 60 characters");
    return problems.length
      ? { ok: false, problems }
      : { ok: true, settings: raw };
  },
  siteFileFor: (settings) => ({ ...settings }),
  webManifest: (settings) => ({
    name: settings.name,
    short_name: settings.name,
  }),
  currencyDigits: (currency, locale = "en") =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits,
  isPng: (bytes) => bytes.subarray(0, 8).equals(PNG.subarray(0, 8)),
  siteLogo: (logo) => ({ path: "/logo.png", type: "image/png", bytes: logo }),
  appIcons: (settings, { logo }) =>
    Object.values(ICON_PATHS).map((path) => ({
      path,
      bytes: Buffer.from(
        `${path} for ${settings.name}, from its ${logo ? "logo" : "monogram"}`,
      ),
    })),
});

export async function writeSettings(
  dir,
  settings = SETTINGS,
  name = "settings.json",
) {
  await writeTree(dir, { [name]: JSON.stringify(settings) });
  return join(dir, name);
}

/** A command context with the stand-in shared, a deploy log and the fake GitHub. */
export async function releaseContext(google, { dryRun = false, logPath } = {}) {
  const ctx = context(google, { dryRun });
  ctx.fetchImpl = google.fetchImpl;
  ctx.loadShared = async () => fakeShared;
  ctx.deployLog = createJsonDeployLog(
    logPath ?? join(await tempDir(), "deploys.json"),
  );
  return ctx;
}

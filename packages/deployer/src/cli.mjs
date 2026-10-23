/**
 * The command line: parse arguments, sign in, run one command, and turn the
 * outcome into an exit code. Everything outside (environment, fetch, the
 * clock, output) comes in through `deps`, so tests run it end to end
 * against a fake Google.
 */
import { parseArgs } from "node:util";

import { createTokenProvider, loadServiceAccountKey } from "./auth.mjs";
import { check } from "./commands/check.mjs";
import { PARTS, deploy } from "./commands/deploy.mjs";
import { migrate } from "./commands/migrate.mjs";
import { owner } from "./commands/owner.mjs";
import { DEFAULT_APP_NAME, provision } from "./commands/provision.mjs";
import { deployRelease, syncBranding } from "./commands/release.mjs";
import { rollback } from "./commands/rollback.mjs";
import { DEFAULT_LOG_FILE, createJsonDeployLog } from "./deploy-log.mjs";
import { ActionNeededError, ApiError, UsageError } from "./errors.mjs";
import { createGoogleClient } from "./http.mjs";
import { createLogger } from "./log.mjs";
import { COMMANDS_WITH_PERMISSIONS } from "./permissions.mjs";
import { releaseVersion } from "./release-package.mjs";

export const EXIT = { ok: 0, failed: 1, usage: 2, actionNeeded: 3 };

const GLOBAL_USAGE = `Global options:
  --project <id>     The cafe's Firebase project ID (required)
  --key <path>       Service-account JSON key (default: $GOOGLE_APPLICATION_CREDENTIALS)
  --dry-run          Read everything, say what would change, change nothing
  --help             Show help for a command`;

const COMMANDS = {
  check: {
    summary: "Test which permissions the service account has on the project",
    usage: `deployer check --project <id> [--for <commands>]

  --for <list>       Only these commands, comma-separated (default: all of
                     ${COMMANDS_WITH_PERMISSIONS.join(", ")})

Exits 3 if any permission is missing.`,
    options: { for: { type: "string" } },
  },
  provision: {
    summary: "Set up a fresh Firebase project for a cafe (safe to re-run)",
    usage: `deployer provision --project <id> --region <location> --site <name> [--app-name <name>]

  --region <loc>     Firestore location, e.g. eur3, nam5, asia-south1
  --site <name>      Hosting site to create: <name>.web.app
  --app-name <name>  Display name of the web app to register (default: ${DEFAULT_APP_NAME})

Exits 3 if a person has to do something first (e.g. the site name is taken).`,
    options: {
      region: { type: "string" },
      site: { type: "string" },
      "app-name": { type: "string" },
    },
  },
  deploy: {
    summary:
      "Deploy a CafeMenu release to a cafe, or rules, indexes and a site",
    usage: `deployer deploy --project <id> --site <name> --version <x.y.z>
                --settings <cafe-settings.json> [--logo <png>]
                [--package <archive>] [--sha256 <hex>] [--log <file>]

  A release: fetch and verify the package, check the data's schema,
  migrate, rules, indexes, config/site, Hosting (the package's site with the
  cafe's site.json, manifest, logo and icons), smoke test, then record it.

  --version <x.y.z>  The release to deploy (x.y.z, x.y.z-beta.N, x.y.z-rc.N)
  --settings <file>  The cafe's settings (CafeSettings JSON, as the console
                     keeps them)
  --logo <png>       The cafe's logo; without one, icons use its monogram
  --package <file>   A local cafemenu-cafe-<version>.tar.gz, with SHA256SUMS
                     next to it, instead of downloading it from GitHub
  --sha256 <hex>     The archive's expected SHA-256, from somewhere you trust
                     more than the release itself
  --log <file>       The deploy log (default: ${DEFAULT_LOG_FILE})

deployer deploy --project <id> [--rules <file>] [--indexes <file>]
                [--site <name> --dir <folder> [--config <firebase.json> [--target <name>]]]
                [--only rules,indexes,hosting] [--message <text>]

  Files from a folder, as they are; nothing is recorded.

  --rules <file>     firestore.rules
  --indexes <file>   firestore.indexes.json
  --site <name>      Hosting site to deploy to
  --dir <folder>     The static build (e.g. out/)
  --config <file>    firebase.json, for the site's headers, redirects,
                     rewrites, cleanUrls, trailingSlash and ignore list
  --target <name>    Which hosting entry in firebase.json, if it has several
  --only <parts>     Deploy only these parts (default: every part whose
                     files are given)
  --message <text>   Description stored with the Hosting release`,
    options: {
      rules: { type: "string" },
      indexes: { type: "string" },
      site: { type: "string" },
      dir: { type: "string" },
      config: { type: "string" },
      target: { type: "string" },
      only: { type: "string" },
      message: { type: "string" },
      version: { type: "string" },
      settings: { type: "string" },
      logo: { type: "string" },
      package: { type: "string" },
      sha256: { type: "string" },
      log: { type: "string" },
    },
  },
  migrate: {
    summary: "Migrate a cafe's data to a schema version, outside a deploy",
    usage: `deployer migrate --project <id> --to <n> [--migrations <folder>]

  Runs the migrations from the data's schema (config/meta.schemaVersion) up
  to <n>, each to the end and then recorded. A run that stops part way
  carries on where it stopped. For a migration the live release can't run
  alongside, which deploy --version refuses: run it while the cafe is closed,
  from a checkout of the release you deploy next.

  --to <n>             The schema version to bring the data to
  --migrations <dir>   Where the migrations are (default: the repository's
                       migrations/)`,
    options: {
      to: { type: "string" },
      migrations: { type: "string" },
    },
  },
  rollback: {
    summary: "Go back to the previous release (rules and Hosting)",
    usage: `deployer rollback --project <id> --site <name> [--log <file>] [--to <version-id>]

  --site <name>      Hosting site
  --log <file>       The deploy log (default: ${DEFAULT_LOG_FILE}). With a
                     release recorded there, rolls back its rules and Hosting
                     files, unless the data has been migrated past them;
                     without one, Hosting only
  --to <version>     Hosting only: release this version instead of the
                     previous one; does nothing if it's already live, so it
                     is safe to retry`,
    options: {
      site: { type: "string" },
      to: { type: "string" },
      log: { type: "string" },
    },
  },
  "sync-branding": {
    summary: "Write a cafe's settings and redeploy only its own files",
    usage: `deployer sync-branding --project <id> --site <name> --settings <file>
                       [--logo <png>] [--log <file>]

  Writes config/site, then serves the live Hosting version's files with the
  cafe's site.json, manifest, logo and icons made afresh. The release stays.

  --settings <file>  The cafe's settings (CafeSettings JSON)
  --logo <png>       The cafe's logo; without one, icons use its monogram
  --log <file>       The deploy log (default: ${DEFAULT_LOG_FILE})`,
    options: {
      site: { type: "string" },
      settings: { type: "string" },
      logo: { type: "string" },
      log: { type: "string" },
    },
  },
  owner: {
    summary: "Create the owner's account and send the set-password email",
    usage: `deployer owner --project <id> --email <email> --name <name>
               [--continue-url <url>] [--no-email]

  --email <email>      The owner's email
  --name <name>        Name shown on the staff board (1-80 characters)
  --continue-url <url> Where the reset page sends them afterwards; its
                       domain must be an authorized domain in Auth
  --no-email           Don't send the set-password email`,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      "continue-url": { type: "string" },
      "no-email": { type: "boolean", default: false },
    },
  },
};

export const USAGE = `Usage: deployer <command> [options]

Sets up a cafe owner's Firebase project and deploys CafeMenu to it.

Commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(14)} ${c.summary}`)
  .join("\n")}

${GLOBAL_USAGE}

Run \`deployer <command> --help\` for a command's options.`;

const commandUsage = (name) =>
  `Usage: ${COMMANDS[name].usage}\n\n${GLOBAL_USAGE}`;

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
// A site name becomes <name>.web.app, so it must be a DNS label.
const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGION = /^[a-z][a-z0-9-]*[0-9]$/;

function required(values, name) {
  const value = values[name]?.trim();
  if (!value) throw new UsageError(`--${name} is required.`);
  return value;
}

function siteName(values) {
  const site = required(values, "site").toLowerCase();
  if (!SITE_NAME.test(site)) {
    throw new UsageError(
      `--site must be lowercase letters, digits and hyphens: ${site}`,
    );
  }
  return site;
}

function list(text, allowed, flag) {
  const items = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = items.filter((item) => !allowed.includes(item));
  if (unknown.length || items.length === 0) {
    throw new UsageError(
      `${flag} takes a comma-separated list of: ${allowed.join(", ")}`,
    );
  }
  return [...new Set(items)];
}

/** `deploy --version`: a release, so none of the folder options. */
function releaseOptions(values) {
  const folderOnly = [
    "rules",
    "indexes",
    "dir",
    "config",
    "target",
    "only",
    "message",
  ];
  const stray = folderOnly.find((name) => values[name] !== undefined);
  if (stray)
    throw new UsageError(
      `--${stray} can't be used with --version: a release brings its own.`,
    );
  const sha256 = values.sha256?.trim().toLowerCase() || undefined;
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256))
    throw new UsageError("--sha256 takes 64 hex digits.");
  return {
    release: true,
    site: siteName(values),
    version: releaseVersion(required(values, "version")),
    settings: required(values, "settings"),
    logo: values.logo?.trim() || undefined,
    package: values.package?.trim() || undefined,
    sha256,
    log: values.log?.trim() || DEFAULT_LOG_FILE,
  };
}

/** Checks and normalises one command's options. Throws UsageError. */
export function commandOptions(command, values) {
  switch (command) {
    case "check":
      return {
        commands: values.for
          ? list(values.for, COMMANDS_WITH_PERMISSIONS, "--for")
          : undefined,
      };
    case "provision": {
      const region = required(values, "region");
      if (!REGION.test(region))
        throw new UsageError(`Not a Firestore location: ${region}`);
      return {
        region,
        site: siteName(values),
        appName: values["app-name"]?.trim() || DEFAULT_APP_NAME,
      };
    }
    case "deploy": {
      if (values.version !== undefined) return releaseOptions(values);
      const releaseOnly = ["settings", "logo", "package", "sha256", "log"];
      const stray = releaseOnly.find((name) => values[name] !== undefined);
      if (stray) throw new UsageError(`--${stray} goes with --version.`);
      const given = {
        rules: values.rules,
        indexes: values.indexes,
        hosting: values.dir,
      };
      const parts = values.only
        ? list(values.only, PARTS, "--only")
        : PARTS.filter((part) => given[part]);
      if (parts.length === 0) {
        throw new UsageError(
          "Nothing to deploy: give --version for a release, or --rules, --indexes and/or --site with --dir.",
        );
      }
      if (parts.includes("rules") && !values.rules)
        throw new UsageError("Deploying rules needs --rules <file>.");
      if (parts.includes("indexes") && !values.indexes)
        throw new UsageError("Deploying indexes needs --indexes <file>.");
      if (parts.includes("hosting") && !values.dir)
        throw new UsageError("Deploying hosting needs --dir <folder>.");
      if (values.target && !values.config)
        throw new UsageError("--target needs --config <firebase.json>.");
      return {
        parts: PARTS.filter((part) => parts.includes(part)),
        rules: values.rules,
        indexes: values.indexes,
        site: parts.includes("hosting") ? siteName(values) : undefined,
        dir: values.dir,
        config: values.config,
        target: values.target,
        message: values.message,
      };
    }
    case "migrate": {
      const to = required(values, "to");
      if (!/^[1-9]\d{0,8}$/.test(to))
        throw new UsageError(`--to takes a schema version (1, 2, …): ${to}`);
      return {
        to: Number(to),
        dir: values.migrations?.trim() || undefined,
      };
    }
    case "rollback":
      return {
        site: siteName(values),
        to: values.to?.trim() || undefined,
        log: values.log?.trim() || DEFAULT_LOG_FILE,
      };
    case "sync-branding":
      return {
        site: siteName(values),
        settings: required(values, "settings"),
        logo: values.logo?.trim() || undefined,
        log: values.log?.trim() || DEFAULT_LOG_FILE,
      };
    case "owner": {
      const email = required(values, "email").toLowerCase();
      if (!EMAIL.test(email)) throw new UsageError(`Not an email: ${email}`);
      const name = required(values, "name");
      if (name.length > 80)
        throw new UsageError("--name must be 1 to 80 characters.");
      const continueUrl = values["continue-url"]?.trim() || undefined;
      if (continueUrl && !/^https:\/\//.test(continueUrl)) {
        throw new UsageError("--continue-url must start with https://");
      }
      return { email, name, continueUrl, sendEmail: !values["no-email"] };
    }
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

/** Parses argv (without node and the script). Throws UsageError. */
export function parseCommandLine(argv) {
  const [command, ...rest] = argv;
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    return { help: USAGE, exit: command ? EXIT.ok : EXIT.usage };
  }
  if (!COMMANDS[command]) throw new UsageError(`Unknown command: ${command}`);
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: {
        project: { type: "string" },
        key: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        ...COMMANDS[command].options,
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { help: commandUsage(command), exit: EXIT.ok };
  const project = required(values, "project");
  if (!PROJECT_ID.test(project))
    throw new UsageError(`Not a project ID: ${project}`);
  return {
    command,
    project,
    keyPath: values.key,
    dryRun: values["dry-run"],
    options: commandOptions(command, values),
  };
}

const RUN = {
  check,
  provision,
  deploy: (ctx, options) =>
    options.release ? deployRelease(ctx, options) : deploy(ctx, options),
  migrate,
  rollback,
  "sync-branding": syncBranding,
  owner,
};

/**
 * Runs the CLI and returns the exit code. `deps` replaces the outside world:
 * {env, fetchImpl, readFile, out, err, sleep, now, loadShared}.
 */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));

  let parsed;
  try {
    parsed = parseCommandLine(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    const command = COMMANDS[argv[0]] ? argv[0] : null;
    err(`${error.message}\n\n${command ? commandUsage(command) : USAGE}`);
    return EXIT.usage;
  }
  if (parsed.help) {
    (parsed.exit === EXIT.ok ? out : err)(parsed.help);
    return parsed.exit;
  }

  try {
    const key = await loadServiceAccountKey({
      keyPath: parsed.keyPath,
      env: deps.env ?? process.env,
      readFile: deps.readFile,
    });
    const getToken = createTokenProvider({
      key,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    const api = createGoogleClient({
      fetchImpl: deps.fetchImpl,
      getToken,
      dryRun: parsed.dryRun,
      sleep: deps.sleep,
      now: deps.now,
    });
    const ctx = {
      api,
      log: createLogger({ write: out, dryRun: parsed.dryRun }),
      project: parsed.project,
      dryRun: parsed.dryRun,
      clientEmail: key.clientEmail,
      readFile: deps.readFile,
      fetchImpl: deps.fetchImpl ?? fetch,
      loadShared: deps.loadShared,
      now: deps.now && (() => new Date(deps.now())),
      deployLog: parsed.options.log && createJsonDeployLog(parsed.options.log),
      sleep:
        deps.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
    const result = await RUN[parsed.command](ctx, parsed.options);
    return result?.ok === false ? EXIT.actionNeeded : EXIT.ok;
  } catch (error) {
    if (error instanceof UsageError) {
      err(error.message);
      return EXIT.usage;
    }
    if (error instanceof ActionNeededError) {
      err(`\n${error.message}${error.hint ? `\n${error.hint}` : ""}`);
      return EXIT.actionNeeded;
    }
    err(`\n${error.message}`);
    if (error instanceof ApiError && error.status === 403) {
      err(
        `Run \`deployer check --project ${parsed.project}\` to see which permissions are missing.`,
      );
    } else {
      err("Re-running is safe: finished steps are skipped.");
    }
    return EXIT.failed;
  }
}

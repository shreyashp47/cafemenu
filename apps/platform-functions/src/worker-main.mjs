/**
 * The worker as a program: `npm run worker -w @cafemenu/platform-functions`.
 * What .github/workflows/backend.yml runs, every five minutes, in place of
 * Cloud Functions (issue #77). One run takes the console's queued requests
 * (requests.mjs) and does the periodic jobs (worker.mjs), then exits.
 *
 * It acts as the platform service account, through Application Default
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS points at its JSON key (the
 * workflow writes the PLATFORM_SERVICE_ACCOUNT secret to a file for it). Under
 * the emulators (FIRESTORE_EMULATOR_HOST, a `demo-` project) no key is needed.
 *
 * The repository is public and so are the logs of this workflow, so what is
 * logged is the message of each line and nothing else: ids, never an owner's
 * address or an email's text.
 *
 * Exit code: 0, whatever became of the requests (a request that fails is
 * answered on the request); 1 when the platform could not be reached or a job
 * failed, which is what turns the workflow run red.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createEnv } from "./runtime.mjs";
import { runWorker } from "./worker.mjs";

const FALLBACK_ACCOUNT = "CafeMenu's deploy account";

/** Log lines for a public log: the level and the message, and the ids a line is about. */
export function createLog(write = console.log) {
  const ID_FIELDS = ["request", "deployment", "cafe", "kind", "key"];
  return (level, message, fields = {}) => {
    const ids = ID_FIELDS.filter((name) => typeof fields[name] === "string")
      .map((name) => `${name}=${fields[name]}`)
      .join(" ");
    write(`[${level}] ${message}${ids ? ` (${ids})` : ""}`);
  };
}

/** The service account's address, from its key file: for messages telling an owner whom to add. */
export async function serviceAccountEmail(env = process.env, read = readFile) {
  const path = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) return FALLBACK_ACCOUNT;
  try {
    const key = JSON.parse(await read(path, "utf8"));
    return typeof key.client_email === "string"
      ? key.client_email
      : FALLBACK_ACCOUNT;
  } catch {
    return FALLBACK_ACCOUNT;
  }
}

/**
 * The log mail sender writes the whole email, and whom it is for, to the log.
 * Here the log is public, so it says only that an email was not sent.
 */
export function quietMail(mail, log) {
  if (mail.sender.name !== "log") return mail;
  return {
    ...mail,
    sender: {
      name: "log",
      send: async ({ subject }) => {
        log("info", `Email not sent (MAIL_PROVIDER is "log"): ${subject}`);
        return { id: null };
      },
    },
  };
}

/** Why this run must not go on, or null. */
export function refusal(env = process.env) {
  if (/^pull_request/.test(env.GITHUB_EVENT_NAME ?? "")) {
    return "The worker never runs for a pull request: it holds the platform's key.";
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS && !env.FIRESTORE_EMULATOR_HOST) {
    return "GOOGLE_APPLICATION_CREDENTIALS isn't set: the worker needs the platform service account's key.";
  }
  return null;
}

/** A line saying what the run did, with no names in it. */
export function describe(summary) {
  const outcomes = {};
  for (const { outcome } of summary.requests) {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  const requests = Object.entries(outcomes)
    .map(([outcome, count]) => `${count} ${outcome}`)
    .join(", ");
  const mail = summary.mail
    ? `emails: ${summary.mail.sent.length} sent, ${summary.mail.failed.length} failed`
    : "emails: not due";
  return `Requests: ${requests || "none"}. ${mail}.`;
}

export async function main(env = process.env, write = console.log) {
  const stop = refusal(env);
  if (stop) {
    write(`[error] ${stop}`);
    return 1;
  }
  const log = createLog(write);
  const platform = await createEnv({
    log,
    clientEmail: serviceAccountEmail(env),
  });
  platform.mail = quietMail(platform.mail, log);
  const by = `worker:${env.GITHUB_RUN_ID ?? randomUUID()}`;
  const summary = await runWorker(platform, { by });
  write(describe(summary));
  return summary.errors.length || summary.mail?.failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
      // Open connections to Google would hold the process up for minutes.
      setTimeout(() => process.exit(code), 1000).unref();
    },
    (error) => {
      console.log(`[error] The worker stopped: ${error.message}`);
      process.exit(1);
    },
  );
}

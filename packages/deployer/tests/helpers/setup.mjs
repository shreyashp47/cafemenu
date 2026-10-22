/** Shared test setup: a throwaway service-account key and a CLI runner. */
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { main } from "../../src/cli.mjs";
import { createGoogleClient } from "../../src/http.mjs";
import { createLogger } from "../../src/log.mjs";
import { PROJECT, createFakeGoogle } from "./fake-google.mjs";

export const CLIENT_EMAIL = "deploy@cafemenu-platform.iam.gserviceaccount.com";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
export const PRIVATE_KEY_PEM = privateKey.export({
  type: "pkcs8",
  format: "pem",
});
export const PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" });

export function keyJson() {
  return {
    type: "service_account",
    project_id: "cafemenu-platform",
    private_key_id: "key-id-1",
    private_key: PRIVATE_KEY_PEM,
    client_email: CLIENT_EMAIL,
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

export async function tempDir() {
  return mkdtemp(join(tmpdir(), "deployer-test-"));
}

export async function writeKeyFile(dir) {
  const path = join(dir, "key.json");
  await writeFile(path, JSON.stringify(keyJson()));
  return path;
}

/** Writes {"relative/path": contents} under `dir`. */
export async function writeTree(dir, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return dir;
}

/**
 * A fake Google plus `run(...args)`, which runs the CLI against it with
 * --project and --key filled in, and returns {code, out, err}. `deps` adds
 * to or replaces what main() is given.
 */
export async function cli({ state, deps = {} } = {}) {
  const dir = await tempDir();
  const keyPath = await writeKeyFile(dir);
  const google = createFakeGoogle({ publicKeyPem: PUBLIC_KEY_PEM, state });
  async function run(...args) {
    const out = [];
    const err = [];
    const code = await main([...args, "--project", PROJECT, "--key", keyPath], {
      env: {},
      fetchImpl: google.fetchImpl,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      sleep: async () => {},
      ...deps,
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }
  return { google, run, dir };
}

/** A command context wired to a fake Google, for calling commands directly. */
export function context(google, { dryRun = false } = {}) {
  const lines = [];
  const api = createGoogleClient({
    fetchImpl: google.fetchImpl,
    getToken: async () => "fake-token-1",
    dryRun,
    sleep: async () => {},
  });
  return {
    api,
    log: createLogger({ write: (line) => lines.push(line), dryRun }),
    project: PROJECT,
    dryRun,
    clientEmail: CLIENT_EMAIL,
    sleep: async () => {},
    lines,
    output: () => lines.join("\n"),
  };
}

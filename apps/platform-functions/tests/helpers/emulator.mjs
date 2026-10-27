/**
 * What the worker's emulator tests share: the Admin SDK for seeding (as the
 * backend's own account would), a browser signed in as an account (the
 * Firebase client SDK, as the console uses it, held to the real rules), a
 * request written as the console writes it, and the worker run as the
 * workflow runs it, in a process of its own.
 */
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { initializeApp as initializeAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setLogLevel,
} from "firebase/firestore";

import { newRequestRecord } from "@cafemenu/shared/requests";

export const PROJECT = "demo-cafemenu";
/** The project the deployer's fake Google answers for. */
export const CAFE_PROJECT = "test-cafe";
const HOST = "127.0.0.1";
const AUTH_PORT = 9199;
const FS_PORT = 8180;
export const PASSWORD = "correct-horse-1";
const APP = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = join(APP, process.env.CAFEMENU_WORKER_DIR ?? ".");

setLogLevel("silent");
process.env.GCLOUD_PROJECT = PROJECT;
const admin = initializeAdmin({ projectId: PROJECT }, "seed");
/** The platform's Firestore and Auth as the backend sees them. */
export const db = getAdminFirestore(admin);
export const adminAuth = getAdminAuth(admin);

/** A browser's Firebase app, not signed in yet. */
export function browser(name) {
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "demo", authDomain: "demo.local" },
    name,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  const store = getFirestore(app);
  connectFirestoreEmulator(store, HOST, FS_PORT);
  return {
    app,
    auth,
    db: store,
    signIn: (email, password = PASSWORD) =>
      signInWithEmailAndPassword(auth, email, password),
    close: () => deleteApp(app),
  };
}

/** A verified account (an admin with `admin`), and a browser signed in as it. */
export async function account(email, { admin: isAdmin = false } = {}) {
  const user = await adminAuth.createUser({
    email,
    password: PASSWORD,
    emailVerified: true,
  });
  if (isAdmin) await adminAuth.setCustomUserClaims(user.uid, { admin: true });
  const b = browser(email);
  await b.signIn(email);
  return { uid: user.uid, email, ...b };
}

/** What the console's requests adapter writes (apps/console/src/lib/data/requests.ts). */
export const ask = (who, cafeId, kind, params = {}) =>
  addDoc(
    collection(who.db, "requests"),
    newRequestRecord({ cafeId, kind, params, by: who.uid }, serverTimestamp()),
  );

const runWorker = promisify(execFile);

/** One run of the backend, as the workflow does it. Returns its log. */
export async function worker(...args) {
  const { stdout } = await runWorker(
    process.execPath,
    ["src/worker/main.mjs", ...args],
    {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        FIRESTORE_EMULATOR_HOST:
          process.env.FIRESTORE_EMULATOR_HOST ?? `${HOST}:${FS_PORT}`,
        FIREBASE_AUTH_EMULATOR_HOST:
          process.env.FIREBASE_AUTH_EMULATOR_HOST ?? `${HOST}:${AUTH_PORT}`,
        CAFEMENU_FAKE_GOOGLE: "http://127.0.0.1:8399",
      },
      timeout: 120_000,
    },
  );
  return stdout;
}

/** Everything a document's listener saw, as the console's would. */
export function watch(ref) {
  const seen = [];
  const stop = onSnapshot(ref, (snap) => {
    const data = snap.data();
    if (data) seen.push(data);
  });
  return { seen, stop, last: () => seen.at(-1) };
}

export async function until(what, read, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The request `w` watches, once the backend has answered it. */
export const finished = (w) => () =>
  ["done", "failed"].includes(w.last()?.status) ? w.last() : null;

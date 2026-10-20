/**
 * Firebase wiring. Only reached through the dynamic `import("./firestore")` in
 * index.ts, so a demo-mode visitor never downloads the SDK.
 */

import { deleteApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  EMULATOR_HOSTS,
  EMULATOR_PROJECT,
  backend,
  firebaseConfig,
} from "../config";

export interface FirebaseTarget {
  options: FirebaseOptions;
  /** Where the Auth and Firestore emulators listen, when using them. */
  emulators: {
    host: string;
    authPort: number;
    firestorePort: number;
  } | null;
}

export interface FirebaseHandles {
  auth: Auth;
  db: Firestore;
  /** Signs out and lets go of the app. For tests. */
  close(): Promise<void>;
}

/** What the environment asks for, or null in demo mode. */
export function targetFromEnv(): FirebaseTarget | null {
  if (backend === "emulators") {
    return {
      options: {
        projectId: EMULATOR_PROJECT,
        apiKey: "demo-key",
        authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
      },
      emulators: { ...EMULATOR_HOSTS },
    };
  }
  if (backend === "firebase" && firebaseConfig) {
    return { options: firebaseConfig, emulators: null };
  }
  return null;
}

/**
 * Starts (or reuses) the Firebase app called `name` and resolves once Auth has
 * restored any saved session, so nothing reads as a signed-out caller in the
 * first few milliseconds after a reload.
 */
export async function connectFirebase(
  target: FirebaseTarget,
  name = "[DEFAULT]",
): Promise<FirebaseHandles> {
  const existing = getApps().find((app) => app.name === name);
  const app = existing ?? initializeApp(target.options, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (!existing && target.emulators) {
    const { host, authPort, firestorePort } = target.emulators;
    connectAuthEmulator(auth, `http://${host}:${authPort}`, {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, host, firestorePort);
  }
  await auth.authStateReady();
  return {
    auth,
    db,
    close: async () => {
      await auth.signOut();
      await deleteApp(app);
    },
  };
}

let handles: Promise<FirebaseHandles> | null = null;

/** The console's one Firebase app, from the environment. */
export function getFirebase(): Promise<FirebaseHandles> {
  const target = targetFromEnv();
  if (!target) {
    return Promise.reject(
      new Error(
        "Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* variables or NEXT_PUBLIC_FIREBASE_EMULATORS, or keep running in demo mode.",
      ),
    );
  }
  handles ??= connectFirebase(target);
  return handles;
}

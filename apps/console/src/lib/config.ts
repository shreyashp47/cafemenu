/**
 * Typed access to the environment.
 *
 * The console must boot with **zero** configuration (see .env.example), so the
 * Firebase block is optional. Without it the console runs in demo mode against
 * a localStorage store; see src/lib/data/.
 *
 * NOTE: every read is a direct `process.env.NEXT_PUBLIC_*` member expression on
 * purpose. Next.js can only inline those statically; routing them through an
 * alias (`const env = process.env`) leaves a live `process` reference that
 * throws in the browser.
 */

import type { Backend } from "./data/types";

const read = (value: string | undefined) => (value ?? "").trim();

/**
 * The emulators' project. A `demo-` project ID can never reach a real Firebase
 * project, so nothing done against the emulators can leak out.
 */
export const EMULATOR_PROJECT = "demo-cafemenu";

/** The ports in firebase.json. */
export const EMULATOR_HOSTS = {
  host: "127.0.0.1",
  authPort: 9199,
  firestorePort: 8180,
  /** apps/platform-functions' emulator, when the functions switch is on. */
  functionsPort: 5101,
} as const;

const useEmulators = ["1", "true"].includes(
  read(process.env.NEXT_PUBLIC_FIREBASE_EMULATORS).toLowerCase(),
);

const firebaseKeysFilled = [
  read(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  read(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  read(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  read(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  read(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  read(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
].every((value) => value.length > 0);

/** The platform project's web config, or `null` when there is none. */
export const firebaseConfig: Record<string, string> | null = firebaseKeysFilled
  ? {
      apiKey: read(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
      authDomain: read(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
      projectId: read(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
      storageBucket: read(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
      messagingSenderId: read(
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      ),
      appId: read(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    }
  : null;

/**
 * How the console reaches the platform's backend, for Check connection,
 * Upgrade, Roll back and Save branding:
 *
 *   requests   writes a `requests/{id}` and watches it. A worker on GitHub
 *              Actions answers within minutes (apps/platform-functions): the
 *              free way, and the one to use. NEXT_PUBLIC_BACKEND=requests
 *   functions  calls the platform's Cloud Functions, which answer at once but
 *              need the Blaze plan. NEXT_PUBLIC_BACKEND=functions (or the
 *              older NEXT_PUBLIC_BACKEND_FUNCTIONS=1)
 *   none       the stand-ins (the emulators) or "not switched on yet" (the
 *              real platform). The default; it changes nothing in demo mode,
 *              which always simulates its backend.
 */
export type BackendMode = "none" | "requests" | "functions";

const backendSetting = read(process.env.NEXT_PUBLIC_BACKEND).toLowerCase();

export const backendMode: BackendMode =
  backendSetting === "requests"
    ? "requests"
    : backendSetting === "functions" ||
        ["1", "true"].includes(
          read(process.env.NEXT_PUBLIC_BACKEND_FUNCTIONS).toLowerCase(),
        )
      ? "functions"
      : "none";

/** Whether the callable Cloud Functions are used: the Blaze option. */
export const useBackendFunctions = backendMode === "functions";

/** The region the platform's functions are deployed to (CAFEMENU_REGION there). */
export const functionsRegion =
  read(process.env.NEXT_PUBLIC_FUNCTIONS_REGION) || "us-central1";

/** Emulators win over a real config, so a stray .env.local cannot leak in. */
export const backend: Backend = useEmulators
  ? "emulators"
  : firebaseKeysFilled
    ? "firebase"
    : "demo";

export const isDemoMode = backend === "demo";

/**
 * Whether the sign-up form is open. Always in demo mode and against the
 * emulators, where nothing real is made. Against the real platform only when
 * NEXT_PUBLIC_SIGNUP_OPEN is set: sign-up is v1.1, and the platform project
 * may be live for the landing page well before then. Until it is set,
 * /signup says sign-up is coming.
 */
export const signupOpen =
  backend !== "firebase" ||
  ["1", "true"].includes(
    read(process.env.NEXT_PUBLIC_SIGNUP_OPEN).toLowerCase(),
  );

/**
 * The stand-in deploy account demo mode and the emulators show. A `demo-`
 * project never exists in real Google Cloud, so adding this address to a
 * real project fails rather than granting anyone anything.
 */
export const DEMO_DEPLOY_ACCOUNT =
  "deploy@demo-cafemenu.iam.gserviceaccount.com";

/**
 * The platform's deploy service account, which each owner adds as a member
 * of their own project (PLAN.md, the owner's step 4). It is settled with the
 * platform project (#2) and set with NEXT_PUBLIC_DEPLOY_SERVICE_ACCOUNT;
 * null against the real platform until then, and the setup page says so.
 */
export const deployAccount: string | null =
  read(process.env.NEXT_PUBLIC_DEPLOY_SERVICE_ACCOUNT) ||
  (backend === "firebase" ? null : DEMO_DEPLOY_ACCOUNT);

/** The public repository, for "read the code" and "run it yourself" links. */
export const REPO_URL = "https://github.com/shreyashp47/cafemenu";

/**
 * Demo mode's platform admin, so /admin has someone to sign in as. The real
 * admin is an account the backend marks with the `admin: true` claim; the
 * demo's only exists in this browser and sees sample cafes.
 */
export const DEMO_ADMIN = {
  email: "admin@cafemenu.demo",
  password: "demo-admin",
} as const;

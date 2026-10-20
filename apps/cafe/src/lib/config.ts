/**
 * What the build itself knows, which is almost nothing on purpose.
 *
 * One build of this app serves every cafe (PLAN.md, "One build per release"),
 * so nothing cafe-specific is read at build time any more. Which Firebase
 * project to talk to is decided when the page loads (src/lib/boot.ts), and the
 * cafe's name, tables and the rest are its settings (src/lib/settings.ts).
 *
 * What is left here is for local development: the six Firebase values in
 * .env.local, which win over everything else, so `npm run dev` can point at a
 * project or the emulators without deploying anything. A release build has
 * none of them set.
 *
 * NOTE: every read is a direct `process.env.NEXT_PUBLIC_*` member expression on
 * purpose. Next.js can only inline those statically; routing them through an
 * alias (`const env = process.env`) leaves a live `process` reference that
 * throws in the browser.
 */

const read = (value: string | undefined) => (value ?? "").trim();

/** A Firebase web app's config, as Hosting's init.json or the console give it. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

/**
 * The Firebase block from .env.local, or `null` unless all six are set. A
 * half-filled block is ignored, as it always was, rather than half-connecting.
 */
export function envFirebaseConfig(): FirebaseWebConfig | null {
  const config = {
    apiKey: read(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: read(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: read(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: read(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: read(
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: read(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };
  return Object.values(config).every((value) => value.length > 0)
    ? config
    : null;
}

/** 4-digit PIN used by the staff login while in demo mode. */
export function getDemoStaffPin(): string {
  const pin = read(process.env.NEXT_PUBLIC_DEMO_STAFF_PIN);
  return /^\d{4,6}$/.test(pin) ? pin : "1122";
}

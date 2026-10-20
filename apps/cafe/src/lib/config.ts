/**
 * Typed, validated access to the environment.
 *
 * The whole app must boot with **zero** configuration (see .env.example), so
 * every getter here has a sane fallback and the Firebase block is optional.
 * When the Firebase block is absent the app runs in "demo mode" against a
 * localStorage-backed store — see src/lib/data/.
 *
 * NOTE: every read is a direct `process.env.NEXT_PUBLIC_*` member expression on
 * purpose. Next.js can only inline those statically; routing them through an
 * alias (`const env = process.env`) leaves a live `process` reference that
 * throws in the browser.
 */

const read = (value: string | undefined) => (value ?? "").trim();

const firebaseKeysFilled = [
  read(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  read(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  read(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  read(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  read(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  read(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
].every((value) => value.length > 0);

/** Raw Firebase config, or `null` when the app should use the demo store. */
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
 * True when no Firebase project is configured. The UI surfaces a small banner
 * so nobody mistakes demo data for real orders.
 */
export const isDemoMode = !firebaseKeysFilled;

export function getCafeName(): string {
  return read(process.env.NEXT_PUBLIC_CAFE_NAME) || "Mochi & Beans";
}

export function getCafeTagline(): string {
  return "Good Coffee, Better Days";
}

/** 4-digit PIN used by the staff login while in demo mode. */
export function getDemoStaffPin(): string {
  const pin = read(process.env.NEXT_PUBLIC_DEMO_STAFF_PIN);
  return /^\d{4,6}$/.test(pin) ? pin : "1122";
}

/**
 * Comma-separated table numbers, e.g. "1,2,3,4,5,6" -> [1..6].
 *
 * Only the *default* now: once the owner saves a list on /admin/qr it lives in
 * Firestore at config/tables and this is used until that document exists (see
 * useTables in src/components/providers/DataProvider.tsx). Numbers above 50 are
 * dropped because firestore.rules refuses an order for them.
 */
export function getTableNumbers(): number[] {
  const parsed = read(process.env.NEXT_PUBLIC_TABLES)
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 50);
  return parsed.length > 0
    ? [...new Set(parsed)].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6];
}

/** Absolute base URL baked into printed QR codes, if the owner pinned one. */
export function getBaseUrl(): string {
  return read(process.env.NEXT_PUBLIC_BASE_URL);
}

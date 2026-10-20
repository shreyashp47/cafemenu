/**
 * Firebase wiring. Loaded **only** once the page has booted into a Firebase
 * project (src/lib/boot.ts), so a demo-mode visitor never downloads the SDK
 * (see issue #3 / NFR "zero/low infrastructure cost, fast on mobile data").
 * Which project is the boot's answer: Hosting's init.json in production, the
 * .env.local block in development.
 *
 * `import type` is erased at compile time, so the type imports below cost
 * nothing at runtime; the value imports are behind a dynamic `import()`.
 */

import { activeFirebaseConfig } from "../boot";

type FirebaseApp = import("firebase/app").FirebaseApp;
type Auth = import("firebase/auth").Auth;
type Firestore = import("firebase/firestore").Firestore;

let appPromise: Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}> | null = null;

async function getFirebase() {
  const firebaseConfig = activeFirebaseConfig();
  if (!firebaseConfig) {
    throw new Error(
      "Firebase is not configured: this page booted into demo mode, or has not booted yet.",
    );
  }

  if (appPromise) return appPromise;
  const created = (async () => {
    const [{ initializeApp, getApps, getApp }, authMod, fsMod] =
      await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = fsMod.initializeFirestore(app, {
      // One long-lived listener per device; keeps reads inside free tier.
      experimentalAutoDetectLongPolling: true,
    });

    // Wait for the SDK to settle who we are before anyone reads or writes.
    // Auth state is restored from IndexedDB, so the first few milliseconds after
    // a cold load have no token yet. A listener attached in that window is
    // treated as anonymous, and the order rules refuse it — which is how a
    // returning customer could be shown "we can't find that order" on a reload
    // and a barista saw a permission error on a board that worked moments later.
    // It resolves immediately when nobody is signed in, so the customer flow
    // that never signs in is unaffected.
    await auth.authStateReady();

    return { app, auth, db };
  })();
  appPromise = created;
  // A failed SDK download must not stick, or the retry screen could never
  // recover without a reload.
  created.catch(() => {
    if (appPromise === created) appPromise = null;
  });
  return created;
}

export default getFirebase;

/**
 * Firebase wiring. Loaded **only** when the Firebase env block is present, so
 * a demo-mode visitor never downloads the SDK (see issue #3 / NFR "zero/low
 * infrastructure cost, fast on mobile data").
 *
 * `import type` is erased at compile time, so the type imports below cost
 * nothing at runtime; the value imports are behind a dynamic `import()`.
 */

import { firebaseConfig } from "../config";

type FirebaseApp = import("firebase/app").FirebaseApp;
type Auth = import("firebase/auth").Auth;
type Firestore = import("firebase/firestore").Firestore;

let appPromise: Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}> | null = null;

async function getFirebase() {
  if (!firebaseConfig) {
    throw new Error(
      "Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* variables, or keep running in demo mode.",
    );
  }

  appPromise ??= (async () => {
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

  return appPromise;
}

export default getFirebase;

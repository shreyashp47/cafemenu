/**
 * The repositories, backed by the platform's Firebase project (or its
 * emulators). Loaded only through the dynamic import in index.ts.
 *
 * firestore.rules decides what each call may do; these adapters only check
 * the input first (validate.ts) so a mistake gets a precise problem code
 * instead of "permission-denied". Their behaviour against the real rules is
 * tested in __tests__/firestore.emulator.test.ts.
 */

import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QuerySnapshot,
} from "firebase/firestore";
import type { Cafe, PlatformUser } from "../platform/model";
import {
  compareVersionsDesc,
  parseCafe,
  parseDeployment,
  parseRelease,
} from "../platform/parse";
import { newCafeRecord } from "../platform/records";
import {
  CafeInputError,
  checkNewCafe,
  checkSettings,
  isProjectId,
  releaseChoiceProblems,
} from "../platform/validate";
import { getFirebase, type FirebaseHandles } from "./firebase";
import {
  CodedError,
  DEPLOYMENT_HISTORY,
  type AuthRepository,
  type Backend,
  type CafeRepository,
  type DataBundle,
  type DeploymentRepository,
  type ErrorListener,
  type ReleaseRepository,
  type Unsubscribe,
} from "./types";

/** How many releases are read at most. Only two minor lines are supported. */
const RELEASE_PAGE = 50;

type Connect = () => Promise<FirebaseHandles>;

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Runs `start` once Firebase is ready, and lets the caller unsubscribe before
 * that has happened without leaking the listener.
 */
function whenReady(
  connect: Connect,
  start: (handles: FirebaseHandles) => Unsubscribe,
  onError?: ErrorListener,
): Unsubscribe {
  let stop: Unsubscribe | null = null;
  let cancelled = false;
  connect().then(
    (handles) => {
      if (!cancelled) stop = start(handles);
    },
    (error) => onError?.(toError(error)),
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** Reads the admin claim and the verified flag from the token, as the rules do. */
export async function toPlatformUser(user: User): Promise<PlatformUser> {
  const { claims } = await user.getIdTokenResult();
  return {
    uid: user.uid,
    email: user.email ?? "",
    emailVerified: claims.email_verified === true,
    isAdmin: claims.admin === true,
  };
}

function requireUser(handles: FirebaseHandles): User {
  const user = handles.auth.currentUser;
  if (!user) throw new CodedError("unauthenticated", "Sign in first.");
  return user;
}

const actionSettings = (continueUrl?: string) =>
  continueUrl ? { url: continueUrl } : undefined;

export function firebaseAuthRepo(connect: Connect): AuthRepository {
  return {
    async signUp(email, password, continueUrl) {
      const { auth } = await connect();
      const { user } = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await sendEmailVerification(user, actionSettings(continueUrl));
    },
    async signIn(email, password) {
      const { auth } = await connect();
      await signInWithEmailAndPassword(auth, email, password);
    },
    async signOut() {
      const { auth } = await connect();
      await signOut(auth);
    },
    async sendVerificationEmail(continueUrl) {
      const user = requireUser(await connect());
      await sendEmailVerification(user, actionSettings(continueUrl));
    },
    async refresh() {
      const user = (await connect()).auth.currentUser;
      if (!user) return;
      await user.reload();
      // A new token carries the new email_verified claim, and fires
      // onIdTokenChanged, so subscribers see the change.
      await user.getIdToken(true);
    },
    subscribe(listener) {
      return whenReady(connect, ({ auth }) =>
        onIdTokenChanged(auth, (user) => {
          if (!user) {
            listener(null);
            return;
          }
          toPlatformUser(user).then(listener, () => listener(null));
        }),
      );
    },
  };
}

const cafesFrom = (snap: QuerySnapshot) =>
  snap.docs
    .map((d) => parseCafe(d.id, d.data({ serverTimestamps: "estimate" })))
    .filter((cafe): cafe is Cafe => cafe !== null)
    .sort((a, b) => a.createdAt - b.createdAt);

export function firestoreCafeRepo(connect: Connect): CafeRepository {
  return {
    subscribeMine(ownerUid, listener, onError) {
      return whenReady(
        connect,
        ({ db }) =>
          onSnapshot(
            query(collection(db, "cafes"), where("ownerUid", "==", ownerUid)),
            (snap) => listener(cafesFrom(snap)),
            (error) => onError?.(error),
          ),
        onError,
      );
    },
    subscribeAll(listener, onError) {
      return whenReady(
        connect,
        ({ db }) =>
          onSnapshot(
            collection(db, "cafes"),
            (snap) => listener(cafesFrom(snap)),
            (error) => onError?.(error),
          ),
        onError,
      );
    },
    async create(input) {
      const check = checkNewCafe(input);
      if (!check.ok) {
        throw new CafeInputError(check.problems, check.settingsProblems);
      }
      const handles = await connect();
      const user = requireUser(handles);
      const ref = doc(collection(handles.db, "cafes"));
      const owner = { uid: user.uid, email: user.email ?? "" };
      const fields = { ...input, settings: check.settings };
      await setDoc(ref, newCafeRecord(owner, fields, serverTimestamp()));
      const cafe = parseCafe(ref.id, newCafeRecord(owner, fields, Date.now()));
      if (!cafe) throw new Error("A new cafe did not parse.");
      return cafe;
    },
    async updateSettings(cafeId, settings) {
      const check = checkSettings(settings);
      if (!check.ok) {
        throw new CafeInputError(["settings-invalid"], check.problems);
      }
      const { db } = await connect();
      await updateDoc(doc(db, "cafes", cafeId), {
        settings: check.settings,
        updatedAt: serverTimestamp(),
      });
    },
    async chooseRelease(cafeId, choice) {
      const problems = releaseChoiceProblems(choice);
      if (problems.length) throw new CafeInputError(problems);
      const { db } = await connect();
      // Field paths, so `current` and `previous` are left exactly as they are:
      // the rules refuse any change to them.
      await updateDoc(doc(db, "cafes", cafeId), {
        "release.channel": choice.channel,
        "release.pinned": choice.pinned,
        updatedAt: serverTimestamp(),
      });
    },
    async connectProject(cafeId, projectId) {
      if (!isProjectId(projectId)) {
        throw new CafeInputError(["project-id-format"]);
      }
      const { db } = await connect();
      await updateDoc(doc(db, "cafes", cafeId), {
        projectId,
        updatedAt: serverTimestamp(),
      });
    },
  };
}

export function firestoreReleaseRepo(connect: Connect): ReleaseRepository {
  return {
    async list() {
      const { db } = await connect();
      const snap = await getDocs(
        query(
          collection(db, "releases"),
          orderBy("publishedAt", "desc"),
          limit(RELEASE_PAGE),
        ),
      );
      return snap.docs
        .map((d) => parseRelease(d.id, d.data()))
        .filter((r) => r !== null)
        .sort((a, b) => compareVersionsDesc(a.version, b.version));
    },
  };
}

export function firestoreDeploymentRepo(
  connect: Connect,
): DeploymentRepository {
  return {
    subscribeForCafe(cafe, listener, onError) {
      return whenReady(
        connect,
        ({ db }) =>
          onSnapshot(
            query(
              collection(db, "deployments"),
              // The owner filter is what lets the rules prove the query only
              // returns this owner's records (firestore.indexes.json).
              where("ownerUid", "==", cafe.ownerUid),
              where("cafeId", "==", cafe.id),
              orderBy("createdAt", "desc"),
              limit(DEPLOYMENT_HISTORY),
            ),
            (snap) =>
              listener(
                snap.docs
                  .map((d) => parseDeployment(d.id, d.data()))
                  .filter((d) => d !== null),
              ),
            (error) => onError?.(error),
          ),
        onError,
      );
    },
  };
}

export function createFirebaseBundle(
  connect: Connect,
  backend: Exclude<Backend, "demo">,
): DataBundle {
  return {
    auth: firebaseAuthRepo(connect),
    cafes: firestoreCafeRepo(connect),
    releases: firestoreReleaseRepo(connect),
    deployments: firestoreDeploymentRepo(connect),
    backend,
  };
}

/** The bundle for the environment's Firebase project. */
export function firebaseBundle(backend: Exclude<Backend, "demo">): DataBundle {
  return createFirebaseBundle(getFirebase, backend);
}

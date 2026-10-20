/**
 * The repositories in demo mode, over demo-store.ts.
 *
 * Each one refuses what firestore.rules refuses, with the same error codes,
 * so demo mode is a fair stand-in: an owner reads and writes only their own
 * cafes, only a verified account writes, `release.current`, `previous`, the
 * status and the plan are never the owner's to set, and the project is fixed
 * once setup has started. No email is sent; demoVerifyEmail() stands in for
 * the link.
 */

import type { Cafe, PlatformUser } from "../platform/model";
import { compareVersionsDesc } from "../platform/parse";
import { newCafeRecord } from "../platform/records";
import {
  CafeInputError,
  checkNewCafe,
  checkSettings,
  isProjectId,
  releaseChoiceProblems,
} from "../platform/validate";
import {
  currentUser,
  load,
  makeId,
  mutate,
  onChange,
  passwordHash,
  type DemoState,
} from "./demo-store";
import {
  CodedError,
  DEPLOYMENT_HISTORY,
  type AuthRepository,
  type CafeRepository,
  type DataBundle,
  type DeploymentRepository,
  type Listener,
  type ReleaseRepository,
  type Unsubscribe,
} from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Firebase's own minimum. */
const MIN_PASSWORD = 6;

const denied = () =>
  new CodedError("permission-denied", "Missing or insufficient permissions.");

/** The caller, who must be signed in with a verified email to write. */
function writer(state: DemoState): PlatformUser {
  const user = currentUser(state);
  if (!user || !user.emailVerified) throw denied();
  return user;
}

/** The caller's own cafe, or a refusal, exactly like the update rule. */
function ownCafe(state: DemoState, cafeId: string): Cafe {
  const user = writer(state);
  const cafe = state.cafes.find((c) => c.id === cafeId);
  if (!cafe) throw new CodedError("not-found", "No such cafe.");
  if (cafe.ownerUid !== user.uid) throw denied();
  return cafe;
}

/** Fires now and after every change, with what `read` returns. */
function live<T>(read: (state: DemoState) => T, listener: Listener<T>) {
  const fire = () => listener(read(load()));
  fire();
  return onChange(fire);
}

export const demoAuthRepo: AuthRepository = {
  async signUp(email, password) {
    const address = email.trim();
    if (!EMAIL.test(address)) throw new CodedError("auth/invalid-email");
    if (password.length < MIN_PASSWORD) {
      throw new CodedError("auth/weak-password");
    }
    mutate((state) => {
      const taken = state.accounts.some(
        (a) => a.email.toLowerCase() === address.toLowerCase(),
      );
      if (taken) throw new CodedError("auth/email-already-in-use");
      const uid = makeId("owner");
      state.accounts.push({
        uid,
        email: address,
        passwordHash: passwordHash(address, password),
        emailVerified: false,
      });
      state.session = uid;
    });
  },
  async signIn(email, password) {
    const address = email.trim();
    mutate((state) => {
      const account = state.accounts.find(
        (a) => a.email.toLowerCase() === address.toLowerCase(),
      );
      if (
        !account ||
        account.passwordHash !== passwordHash(address, password)
      ) {
        throw new CodedError("auth/invalid-credential");
      }
      state.session = account.uid;
    });
  },
  async signOut() {
    mutate((state) => {
      state.session = null;
    });
  },
  async sendVerificationEmail() {
    if (!currentUser(load())) {
      throw new CodedError("unauthenticated", "Sign in first.");
    }
    // Demo mode sends no email. demoVerifyEmail() is the link.
  },
  async refresh() {
    mutate(() => undefined);
  },
  subscribe(listener) {
    let last: string | undefined;
    // Only on a real change, as onIdTokenChanged does, not on every cafe write.
    return live(currentUser, (user) => {
      const key = JSON.stringify(user);
      if (key === last) return;
      last = key;
      listener(user);
    });
  },
};

/**
 * Demo mode's stand-in for clicking the link in the verification email: marks
 * the signed-in account verified.
 */
export function demoVerifyEmail() {
  mutate((state) => {
    const account = state.accounts.find((a) => a.uid === state.session);
    if (!account) throw new CodedError("unauthenticated", "Sign in first.");
    account.emailVerified = true;
  });
}

const byCreated = (a: Cafe, b: Cafe) => a.createdAt - b.createdAt;

export const demoCafeRepo: CafeRepository = {
  subscribeMine(ownerUid, listener, onError) {
    let failed = false;
    return live(
      (state) => {
        // A query for someone else's cafes is refused outright, as in the rules.
        if (currentUser(state)?.uid !== ownerUid) return null;
        return state.cafes
          .filter((c) => c.ownerUid === ownerUid)
          .sort(byCreated);
      },
      (cafes) => {
        if (cafes) listener(cafes);
        else if (!failed) {
          failed = true;
          onError?.(denied());
        }
      },
    );
  },
  subscribeAll(_listener, onError): Unsubscribe {
    // Only the platform admin may list every cafe, and demo mode has none.
    onError?.(denied());
    return () => {};
  },
  async create(input) {
    const check = checkNewCafe(input);
    if (!check.ok) {
      throw new CafeInputError(check.problems, check.settingsProblems);
    }
    return mutate((state) => {
      const user = writer(state);
      const fields = { ...input, settings: check.settings };
      const cafe: Cafe = {
        id: makeId("cafe"),
        ...newCafeRecord(user, fields, Date.now()),
      };
      state.cafes.push(cafe);
      return structuredClone(cafe);
    });
  },
  async updateSettings(cafeId, settings) {
    const check = checkSettings(settings);
    if (!check.ok) {
      throw new CafeInputError(["settings-invalid"], check.problems);
    }
    mutate((state) => {
      const cafe = ownCafe(state, cafeId);
      // The plan is the backend's to change (#17), as in the rules.
      if (check.settings.plan !== cafe.settings.plan) throw denied();
      cafe.settings = structuredClone(check.settings);
      cafe.updatedAt = Date.now();
    });
  },
  async chooseRelease(cafeId, choice) {
    const problems = releaseChoiceProblems(choice);
    if (problems.length) throw new CafeInputError(problems);
    mutate((state) => {
      const cafe = ownCafe(state, cafeId);
      cafe.release = {
        ...cafe.release,
        channel: choice.channel,
        pinned: choice.pinned,
      };
      cafe.updatedAt = Date.now();
    });
  },
  async connectProject(cafeId, projectId) {
    if (!isProjectId(projectId)) {
      throw new CafeInputError(["project-id-format"]);
    }
    mutate((state) => {
      const cafe = ownCafe(state, cafeId);
      // Once setup has started, the project is fixed.
      if (cafe.status !== "draft") throw denied();
      cafe.projectId = projectId;
      cafe.updatedAt = Date.now();
    });
  },
};

export const demoReleaseRepo: ReleaseRepository = {
  async list() {
    const state = load();
    if (!currentUser(state)?.emailVerified) throw denied();
    return [...state.releases].sort((a, b) =>
      compareVersionsDesc(a.version, b.version),
    );
  },
};

export const demoDeploymentRepo: DeploymentRepository = {
  subscribeForCafe(cafe, listener, onError) {
    let failed = false;
    return live(
      (state) => {
        if (currentUser(state)?.uid !== cafe.ownerUid) return null;
        return state.deployments
          .filter((d) => d.cafeId === cafe.id && d.ownerUid === cafe.ownerUid)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, DEPLOYMENT_HISTORY);
      },
      (deployments) => {
        if (deployments) listener(deployments);
        else if (!failed) {
          failed = true;
          onError?.(denied());
        }
      },
    );
  },
};

export const demoBundle: DataBundle = {
  auth: demoAuthRepo,
  cafes: demoCafeRepo,
  releases: demoReleaseRepo,
  deployments: demoDeploymentRepo,
  backend: "demo",
};

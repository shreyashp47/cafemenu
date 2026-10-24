/**
 * The repositories in demo mode, over demo-store.ts.
 *
 * Each one refuses what firestore.rules refuses, with the same error codes,
 * so demo mode is a fair stand-in: an owner reads and writes only their own
 * cafes, only a verified account writes, `release.current`, `previous`, the
 * status and the plan are never the owner's to set, and the project is fixed
 * once setup has started; the logo and starting menu are the owner's to
 * write only while the cafe is a draft (the logo also while it is live). No
 * email is sent; demoVerifyEmail()
 * stands in for the link.
 */

import type { Cafe, PlatformUser } from "../platform/model";
import { compareVersionsDesc, parseStartingMenu } from "../platform/parse";
import {
  logoRecord,
  newCafeRecord,
  startingMenuRecord,
} from "../platform/records";
import {
  CafeInputError,
  SetupInputError,
  checkNewCafe,
  checkSettings,
  isProjectId,
  logoProblems,
  releaseChoiceProblems,
  startingMenuProblems,
} from "../platform/validate";
import { fromBase64, toBase64 } from "../bytes";
import { simulatedConnectionChecker } from "../setup/connection";
import { simulatedSiteChecker } from "./checks";
import {
  demoDeployRequests,
  demoGoLive as goLive,
  resumeDemoRuns,
} from "./demo-deploys";
import {
  currentUser,
  load,
  loadSetup,
  makeId,
  mutate,
  onChange,
  passwordHash,
  saveSetup,
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
  type SetupRepository,
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

/** The caller's own cafe while it is still a draft: the setup rules. */
function ownDraft(state: DemoState, cafeId: string): Cafe {
  const cafe = ownCafe(state, cafeId);
  if (cafe.status !== "draft") throw denied();
  return cafe;
}

/**
 * The caller's own cafe while it is a draft or live: the logo's rules. A live
 * cafe may replace its logo, which the backend then puts on its site.
 */
function ownLogoCafe(state: DemoState, cafeId: string): Cafe {
  const cafe = ownCafe(state, cafeId);
  if (cafe.status !== "draft" && cafe.status !== "live") throw denied();
  return cafe;
}

/**
 * The caller's own cafe, to read its setup documents: signed in, not
 * necessarily verified, as for reading the cafe. A cafe that does not exist
 * is refused, as the rules' lookup of it fails.
 */
function readableCafe(state: DemoState, cafeId: string): Cafe {
  const user = currentUser(state);
  const cafe = state.cafes.find((c) => c.id === cafeId);
  if (!user || !cafe || cafe.ownerUid !== user.uid) throw denied();
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

export const demoSetupRepo: SetupRepository = {
  async saveLogo(cafeId, png) {
    const problems = logoProblems(png);
    if (problems.length) throw new SetupInputError(problems);
    ownLogoCafe(load(), cafeId);
    saveSetup(cafeId, "logo", logoRecord(toBase64(png), Date.now()));
  },
  async removeLogo(cafeId) {
    ownLogoCafe(load(), cafeId);
    saveSetup(cafeId, "logo", null);
  },
  async getLogo(cafeId) {
    readableCafe(load(), cafeId);
    const record = loadSetup(cafeId, "logo") as { png?: unknown } | null;
    return typeof record?.png === "string" ? fromBase64(record.png) : null;
  },
  async saveMenu(cafe, menu) {
    const problems = startingMenuProblems(menu, cafe.settings);
    if (problems.length) throw new SetupInputError(problems);
    const stored = ownDraft(load(), cafe.id);
    // The rules compare with the stored cafe, not the one the caller passed.
    if (stored.settings.currency !== menu.currency) throw denied();
    saveSetup(cafe.id, "menu", startingMenuRecord(menu, Date.now()));
  },
  async getMenu(cafeId) {
    readableCafe(load(), cafeId);
    return parseStartingMenu(loadSetup(cafeId, "menu"));
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
    // A run left going by an earlier visit carries on.
    resumeDemoRuns();
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

/** Upgrade, Roll back and Save branding, simulated (demo-deploys.ts). */
export const demoDeploys = demoDeployRequests(ownCafe);

/**
 * Demo mode's stand-in for the backend finishing a cafe's setup (#28), so
 * the owner area has a live cafe to show. Not part of any repository.
 */
export const demoGoLive = (cafeId: string) => goLive(ownCafe, cafeId);

export const demoBundle: DataBundle = {
  auth: demoAuthRepo,
  cafes: demoCafeRepo,
  setup: demoSetupRepo,
  // Every demo cafe is in this browser, whoever signed it up.
  sites: simulatedSiteChecker(() => load().cafes.map((c) => c.site)),
  // Long enough for "Checking…" to be read.
  connection: simulatedConnectionChecker(600),
  releases: demoReleaseRepo,
  deployments: demoDeploymentRepo,
  deploys: demoDeploys,
  backend: "demo",
};

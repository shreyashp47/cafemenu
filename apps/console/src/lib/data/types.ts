/**
 * Storage contracts for the console. Two implementations satisfy them, as in
 * the cafe app: Firebase (the platform project, or its emulators) and a
 * localStorage demo store, so the console runs with no configuration.
 *
 * Errors carry Firebase's codes in both ("auth/invalid-credential",
 * "permission-denied"…), so a page maps one set of codes to words.
 */

import type { CafeSettings } from "@cafemenu/shared";
import type {
  Cafe,
  Deployment,
  PlatformUser,
  Release,
  StartingMenu,
} from "../platform/model";
import type { NewCafeInput, ReleaseChoice } from "../platform/validate";
import type { ConnectionChecker } from "../setup/connection";

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;
export type ErrorListener = (error: Error) => void;

export interface AuthRepository {
  /**
   * Creates an email/password account, signs it in, and sends the link that
   * verifies the email. `continueUrl` is where the link lands afterwards; it
   * must be on a domain the platform project authorises.
   */
  signUp(email: string, password: string, continueUrl?: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Sends the verification link again, to the signed-in account. */
  sendVerificationEmail(continueUrl?: string): Promise<void>;
  /**
   * Re-reads the signed-in account and gets it a fresh token, after the owner
   * clicked the link (perhaps on another device). The rules read
   * `email_verified` from the token, so writes stay refused until this runs.
   */
  refresh(): Promise<void>;
  /** Fires straight away with the account (or null), then on every change. */
  subscribe(listener: Listener<PlatformUser | null>): Unsubscribe;
}

export interface CafeRepository {
  /** The owner's own cafes, live, oldest first. */
  subscribeMine(
    ownerUid: string,
    listener: Listener<Cafe[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /** Every cafe, live, oldest first. Admin only: the rules refuse others. */
  subscribeAll(
    listener: Listener<Cafe[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /**
   * A new cafe for the signed-in, verified account, as a draft. Throws
   * CafeInputError before writing anything if the input breaks a rule.
   */
  create(input: NewCafeInput): Promise<Cafe>;
  /**
   * Owner: replaces the cafe's settings, cleaned by validateCafeSettings.
   * `settings.plan` must be the plan the cafe already has: only the backend
   * changes it, and the rules refuse anything else.
   */
  updateSettings(cafeId: string, settings: CafeSettings): Promise<void>;
  /** Owner: follow stable or beta, and optionally stay on one minor line. */
  chooseRelease(cafeId: string, choice: ReleaseChoice): Promise<void>;
  /** Owner: the Firebase project to set up. Only while the cafe is a draft. */
  connectProject(cafeId: string, projectId: string): Promise<void>;
}

/**
 * What the owner gives at sign-up that does not fit in the cafe record: the
 * logo and the starting menu (`cafes/{cafeId}/setup/…`; see model.ts). Only
 * the owner writes them, only while the cafe is a draft, and provisioning
 * (#28) copies them into the owner's own project.
 */
export interface SetupRepository {
  /**
   * The logo, as a PNG already shrunk to fit SETUP_LOGO_SIDE. Throws
   * SetupInputError before writing anything if it is not a PNG or too big.
   */
  saveLogo(cafeId: string, png: Uint8Array): Promise<void>;
  removeLogo(cafeId: string): Promise<void>;
  /** The owner's own logo, or null when there is none. */
  getLogo(cafeId: string): Promise<Uint8Array | null>;
  /**
   * The starting menu. Takes the cafe for its currency: the prices must be in
   * it. Throws SetupInputError before writing anything if a check fails.
   */
  saveMenu(
    cafe: Pick<Cafe, "id" | "settings">,
    menu: StartingMenu,
  ): Promise<void>;
  getMenu(cafeId: string): Promise<StartingMenu | null>;
}

/**
 * Whether a web address name looks free, at sign-up:
 *
 *   looks-free  nothing says it is taken. Not a promise: names are unique
 *               across all of Firebase, and only provisioning can be sure
 *   taken       someone has it
 *   unknown     there is no way to tell from here yet
 */
export type SiteAvailability = "looks-free" | "taken" | "unknown";

export interface SiteNameChecker {
  check(site: string): Promise<SiteAvailability>;
}

export interface ReleaseRepository {
  /** Published releases, newest version first. Needs a verified account. */
  list(): Promise<Release[]>;
}

export interface DeploymentRepository {
  /**
   * One cafe's deployments, live, newest first. Takes the cafe rather than its
   * id because the query has to name the owner for the rules to allow it.
   */
  subscribeForCafe(
    cafe: Pick<Cafe, "id" | "ownerUid">,
    listener: Listener<Deployment[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
}

/** How many deployments a cafe's history shows. */
export const DEPLOYMENT_HISTORY = 20;

/** Where the data comes from. */
export type Backend = "demo" | "emulators" | "firebase";

export interface DataBundle {
  auth: AuthRepository;
  cafes: CafeRepository;
  setup: SetupRepository;
  sites: SiteNameChecker;
  /** "Check connection" in onboarding; see src/lib/setup/connection.ts. */
  connection: ConnectionChecker;
  releases: ReleaseRepository;
  deployments: DeploymentRepository;
  backend: Backend;
}

/** An error with a Firebase-style code, thrown by the demo store. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message);
    this.name = "CodedError";
  }
}

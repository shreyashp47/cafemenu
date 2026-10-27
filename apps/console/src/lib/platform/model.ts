/**
 * The platform's own data: what the console keeps in the platform Firebase
 * project. A cafe's menu, orders and staff are not here; they live in the
 * owner's own project (PLAN.md, "How it fits together").
 *
 *   cafes/{cafeId}         one per cafe: who owns it, where it runs, which
 *                          release it is on. The owner reads and edits it.
 *                          The backend also keeps `emails.releaseNotices` here
 *                          (false once the owner unsubscribed from the
 *                          release emails; the owner never writes it).
 *   cafes/{cafeId}/setup/  the logo and starting menu from sign-up, until
 *     {logo,menu}          provisioning copies them into the owner's project.
 *   releases/{version}     one per published release. Written by the backend.
 *   deployments/{id}       one per setup, deploy, rollback or branding sync.
 *                          Written by the backend.
 *   requests/{id}          what an owner (or the admin) asked the backend for:
 *                          written once by them, answered by the backend
 *                          (#77; the shape is @cafemenu/shared/requests).
 *   owners/{uid}           the admin's directory of accounts (#78), copied
 *                          from Authentication by the backend. Admin only.
 *   adminLog/{id}          every admin action (#78), written once by the
 *                          backend and never changed. Admin only.
 *   cafes/{id}/emails/     the emails sent to a cafe's owner, for the admin's
 *                          history of it (#78). Admin only.
 *
 * firestore.rules is the real boundary; the checks in validate.ts mirror it so
 * the console can say what is wrong before a write is refused. Change all
 * three together, with a case in scripts/rules-test.mjs.
 *
 * Times are milliseconds since the epoch in the app, and Firestore Timestamps
 * in the database.
 */

import type { CafeSettings } from "@cafemenu/shared";
import type { RequestKind, RequestStatus } from "@cafemenu/shared/requests";

// -- releases ----------------------------------------------------------------

/**
 * Stable is the default. Beta gets new versions first (PLAN.md, "Releases").
 * A release record's own channel is the most stable channel it has reached:
 * it is published to beta, then promoted to stable.
 */
export const RELEASE_CHANNELS = ["stable", "beta"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** The release fields of a cafe. */
export interface CafeRelease {
  /** Which versions the cafe follows. The owner chooses. */
  channel: ReleaseChannel;
  /**
   * A minor line such as "1.4" to stay on it ("Stay on 1.4"), or null to take
   * every new version of the channel. Patch releases of the pinned line still
   * apply automatically, so security fixes reach everyone. The owner chooses.
   */
  pinned: string | null;
  /** The version running now; null until the first deploy. Backend only. */
  current: string | null;
  /** The version before `current`: what "Roll back" goes to. Backend only. */
  previous: string | null;
}

export interface Release {
  /** Semantic version, also the document id: "1.4.2". */
  version: string;
  channel: ReleaseChannel;
  /** Release notes, as Markdown. */
  notes: string;
  publishedAt: number;
  /**
   * The cafe database schema this release expects (`config/meta.schemaVersion`
   * in each cafe's project). The deployer runs the migrations up to it.
   */
  schemaVersion: number;
  /** Pulled after publishing: no cafe is moved onto it any more. */
  withdrawn: boolean;
}

// -- cafes -------------------------------------------------------------------

/**
 * Where a cafe is in its life. Only the backend moves it on: an owner creates
 * a cafe as `draft` and can never set the status.
 *
 *   draft         signed up; the owner has not connected a project yet
 *   provisioning  the deployer is setting the owner's project up
 *   live          running
 *   failed        setup failed, and needs a look before it is retried
 *   disconnected  the owner removed CafeMenu's access; the site keeps running
 *                 on its last release
 *   suspended     stopped by the platform admin
 */
export const CAFE_STATUSES = [
  "draft",
  "provisioning",
  "live",
  "failed",
  "disconnected",
  "suspended",
] as const;
export type CafeStatus = (typeof CAFE_STATUSES)[number];

export interface Cafe {
  id: string;
  /** The platform account that owns this cafe. Never changes. */
  ownerUid: string;
  /** That account's email when the cafe was created. */
  ownerEmail: string;
  /**
   * The owner's own Firebase project, pasted in at the "Give CafeMenu access"
   * step; null until then.
   */
  projectId: string | null;
  /** The Hosting site name: "their-cafe" serves their-cafe.web.app. */
  site: string;
  /**
   * Where the cafe's Firestore database is created: a location ID from
   * ./locations.ts, such as "asia-south1". Chosen at sign-up from the
   * country; fixed once setup starts, since a database cannot move. Null on
   * a record written before sign-up asked for it.
   */
  region: string | null;
  /**
   * The cafe's name, look, currency, locale and time zone, in the shape the
   * cafe app reads. Edited in the console; the backend copies it to the cafe's
   * `config/site` and deployed files on the next sync. `settings.plan` is the
   * backend's to change, not the owner's.
   */
  settings: CafeSettings;
  release: CafeRelease;
  status: CafeStatus;
  /**
   * Why the admin last suspended or reactivated it, and when (#78). Null
   * when the admin never has; absent on a record built in the app.
   */
  statusReason?: AdminReason | null;
  statusChangedAt?: number | null;
  /** CafeMenu's maintenance of its site (#78), as the backend set it. */
  maintenance?: CafeMaintenance | null;
  createdAt: number;
  updatedAt: number;
}

// -- the super admin (#78) ------------------------------------------------------

/** A reason from the policy's list (@cafemenu/shared/admin-policy), and a note. */
export interface AdminReason {
  /** Null for an action that needs none, such as maintenance off. */
  code: string | null;
  note: string;
}

/**
 * CafeMenu's maintenance of a cafe's site, as the backend keeps it on the
 * cafe: what it put in the cafe's own `config/site.maintenance` (times in
 * ms), and why, which only the admin and the owner read here.
 */
export interface CafeMaintenance {
  on: true;
  by: "admin" | "owner";
  message: string;
  until: number | null;
  startsAt: number | null;
  endsAt: number | null;
  reason: AdminReason | null;
  setAt: number | null;
  setBy: string | null;
  /** The bulk action it was part of, if any. */
  batch: string | null;
}

export const OWNER_STATUSES = ["active", "suspended"] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

/** One `owners/{uid}`: an account in the admin's directory. */
export interface OwnerRecord {
  uid: string;
  email: string;
  name: string | null;
  /** Sign-up and last console sign-in, from Authentication. */
  createdAt: number | null;
  lastSignInAt: number | null;
  admin: boolean;
  disabled: boolean;
  status: OwnerStatus;
  statusReason: AdminReason | null;
  statusChangedAt: number | null;
}

/** One `adminLog/{id}`: who did what, to which cafe, when and why. */
export interface AdminLogEntry {
  id: string;
  at: number;
  /** The admin's uid, and their email then. */
  by: string;
  byEmail: string | null;
  /** The request kind: "suspend", "maintenance-on"… */
  action: string;
  cafeId: string | null;
  ownerUid: string | null;
  reason: AdminReason | null;
  details: Record<string, unknown>;
}

/** One `cafes/{id}/emails/{id}`: an email the backend sent the owner. */
export interface SentEmail {
  id: string;
  /** The template: "account-suspended", "release-available"… */
  kind: string;
  at: number;
}

// -- what the owner gives at sign-up ---------------------------------------------

/**
 * Two documents under a draft cafe, `cafes/{cafeId}/setup/{logo,menu}`, kept
 * on the platform until provisioning (#28) copies them into the owner's own
 * project, and then the cafe's own dashboard is where they change:
 *
 *   logo  the logo as a PNG, already shrunk to fit SETUP_LOGO_SIDE, for
 *         `siteLogo` and `appIcons` from @cafemenu/shared/icons to turn into
 *         the site's /logo.png and its app icons (`settings.logo` is then
 *         "/logo.png")
 *   menu  the starting menu, as the rows the cafe app's import writes
 *
 * The rules let only the owner write them, and only while the cafe is a
 * draft. They cannot look inside every menu row, so the deployer checks the
 * rows again before loading them, as it does the settings.
 */
export const SETUP_PARTS = ["logo", "menu"] as const;
export type SetupPart = (typeof SETUP_PARTS)[number];

/** The longest side of a stored logo, in pixels: the size of the largest icon. */
export const SETUP_LOGO_SIDE = 512;
/**
 * The most a stored logo may weigh. A Firestore document holds 1 MiB, and a
 * 512-pixel PNG of a real logo is a small fraction of this.
 */
export const SETUP_LOGO_MAX_BYTES = 750_000;

/**
 *   template  one of the starter menus from @cafemenu/shared, priced in the
 *             cafe's currency, perhaps edited
 *   blank     no menu: the owner adds items in their dashboard
 *   import    a list or CSV the owner pasted or uploaded
 */
export const STARTING_MENU_SOURCES = ["template", "blank", "import"] as const;
export type StartingMenuSource = (typeof STARTING_MENU_SOURCES)[number];

/** One row of the starting menu: what the cafe app's menu import writes. */
export interface StartingMenuItem {
  name: string;
  category: string;
  description: string;
  /** In minor units of `StartingMenu.currency`, above 0. */
  price: number;
  available: boolean;
}

export interface StartingMenu {
  source: StartingMenuSource;
  /** The starter menu's id ("coffee-shop") when `source` is template. */
  template: string | null;
  /**
   * The currency the prices are in. The deployer will not load them into a
   * cafe whose currency has changed since: 450 cents are not 450 yen.
   */
  currency: string;
  items: StartingMenuItem[];
}

// -- deployments ---------------------------------------------------------------

/**
 *   provision  first setup of an owner's project (onboarding step 5)
 *   deploy     a release onto a cafe: upgrade, patch or rollout wave
 *   rollback   back to `release.previous`
 *   branding   the cafe's settings re-deployed on its current release
 */
export const DEPLOYMENT_KINDS = [
  "provision",
  "deploy",
  "rollback",
  "branding",
] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

export const DEPLOYMENT_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "rolled-back",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Who started it: the owner's button, a rollout wave, or the admin. */
export const DEPLOYMENT_TRIGGERS = ["owner", "rollout", "admin"] as const;
export type DeploymentTrigger = (typeof DEPLOYMENT_TRIGGERS)[number];

export const STEP_STATUSES = ["pending", "running", "done", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** One line of the progress screen: "Deploy the rules", "Load the menu"… */
export interface DeploymentStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface Deployment {
  id: string;
  cafeId: string;
  /**
   * Copied from the cafe, so the rules can let an owner list their own
   * deployments without a lookup per document.
   */
  ownerUid: string;
  kind: DeploymentKind;
  /** The version being deployed; null for a branding sync of no release. */
  version: string | null;
  /** The version it replaces; null on a first deploy. */
  fromVersion: string | null;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  steps: DeploymentStep[];
  /** What went wrong, in words an owner can act on; null unless it failed. */
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

// -- requests to the backend (#77) -----------------------------------------------

export type { RequestKind, RequestStatus };

/**
 * What a request has come to, as the backend writes it while it works: the
 * steps of the deployment it became (or of the check), and what is
 * happening now.
 */
export interface RequestProgress {
  steps: DeploymentStep[];
  detail: string | null;
}

/**
 * One `requests/{id}`: written by a person (cafeId, kind, params, status
 * "queued", createdAt, by), then only by the backend, which picks it up on
 * its next run (every 5 minutes on GitHub Actions) and answers on it.
 */
export interface BackendRequest {
  id: string;
  /** Null for a request about an account rather than a cafe (appoint-admin). */
  cafeId: string | null;
  kind: RequestKind;
  params: Record<string, unknown>;
  status: RequestStatus;
  /** Who asked. */
  by: string;
  createdAt: number;
  /** Null until the backend has started on it. */
  progress: RequestProgress | null;
  /**
   * What came of it: a check's ConnectionResult, or for the other kinds
   * {deploymentId, outcome, siteUrl?}. Null until it is done.
   */
  result: unknown;
  /** Why it failed, in words for the owner; null unless it did. */
  error: string | null;
  errorCode: string | null;
  /** The deployment it became, once the backend has queued it. */
  deploymentId: string | null;
  /** A request waiting for its date (a suspension's notice): not before then. */
  notBefore: number | null;
  finishedAt: number | null;
}

// -- accounts ------------------------------------------------------------------

/** A signed-in console account: an owner, or the platform admin. */
export interface PlatformUser {
  uid: string;
  email: string;
  /**
   * The rules refuse every write from an unverified account, so the console
   * asks for the link to be clicked first.
   */
  emailVerified: boolean;
  /**
   * The `admin: true` custom claim, set by the backend for the maintainer.
   * Admins can read every cafe and deployment; they write through the backend,
   * like everyone else.
   */
  isAdmin: boolean;
}

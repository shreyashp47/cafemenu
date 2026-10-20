/**
 * The platform's own data: what the console keeps in the platform Firebase
 * project. A cafe's menu, orders and staff are not here; they live in the
 * owner's own project (PLAN.md, "How it fits together").
 *
 *   cafes/{cafeId}         one per cafe: who owns it, where it runs, which
 *                          release it is on. The owner reads and edits it.
 *   releases/{version}     one per published release. Written by the backend.
 *   deployments/{id}       one per setup, deploy, rollback or branding sync.
 *                          Written by the backend.
 *
 * firestore.rules is the real boundary; the checks in validate.ts mirror it so
 * the console can say what is wrong before a write is refused. Change all
 * three together, with a case in scripts/rules-test.mjs.
 *
 * Times are milliseconds since the epoch in the app, and Firestore Timestamps
 * in the database.
 */

import type { CafeSettings } from "@cafemenu/shared";

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
   * The cafe's name, look, currency, locale and time zone, in the shape the
   * cafe app reads. Edited in the console; the backend copies it to the cafe's
   * `config/site` and deployed files on the next sync. `settings.plan` is the
   * backend's to change, not the owner's.
   */
  settings: CafeSettings;
  release: CafeRelease;
  status: CafeStatus;
  createdAt: number;
  updatedAt: number;
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

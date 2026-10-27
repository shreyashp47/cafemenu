/**
 * Sample cafes for the demo admin (#30): other owners' cafes in every state
 * the admin page has to show, with the deployments that explain them. They
 * are written into the demo store the first time DEMO_ADMIN signs in, and
 * belong to no account, so no demo owner ever sees one. None of it is real.
 */

import { newCafeSettings } from "@cafemenu/shared";
import type {
  AdminLogEntry,
  Cafe,
  CafeStatus,
  Deployment,
  DeploymentKind,
  DeploymentStatus,
  DeploymentTrigger,
} from "../platform/model";
import type { DemoEmail, DemoState } from "./demo-store";
import type { RolloutStatus } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A deployment's own steps, as the deployer records them. */
const STEPS = [
  ["package", "Fetch and verify the release package"],
  ["migrations", "Migrate the cafe's data"],
  ["rules", "Firestore rules"],
  ["indexes", "Firestore indexes"],
  ["settings", "Cafe settings"],
  ["hosting", "Hosting"],
  ["smoke", "Smoke test"],
] as const;

/** The first `done` steps are done; `at`, if set, is running or failed. */
function steps(done: number, at?: "running" | "failed"): Deployment["steps"] {
  return STEPS.map(([id, label], i) => ({
    id,
    label,
    status:
      i < done
        ? ("done" as const)
        : i === done && at
          ? at
          : ("pending" as const),
  }));
}

interface Spec {
  id: string;
  name: string;
  site: string;
  status: CafeStatus;
  channel: "stable" | "beta";
  pinned: string | null;
  current: string | null;
  previous: string | null;
}

const SPECS: Spec[] = [
  {
    id: "sample-harbour",
    name: "Harbour Beans",
    site: "harbour-beans",
    status: "live",
    channel: "stable",
    pinned: null,
    current: "1.1.1",
    previous: "1.1.0",
  },
  {
    id: "sample-lamp",
    name: "The Lamp Room",
    site: "lamp-room",
    status: "live",
    channel: "beta",
    pinned: null,
    current: "1.2.0-beta.1",
    previous: "1.1.1",
  },
  {
    id: "sample-corner",
    name: "Corner Pantry",
    site: "corner-pantry",
    status: "live",
    channel: "stable",
    pinned: "1.0",
    current: "1.0.0",
    previous: null,
  },
  {
    id: "sample-orchard",
    name: "Orchard Tea House",
    site: "orchard-tea",
    status: "live",
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: "1.0.0",
  },
  {
    id: "sample-tide",
    name: "Tide & Toast",
    site: "tide-and-toast",
    status: "disconnected",
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: "1.0.0",
  },
  {
    id: "sample-new",
    name: "Juniper Kitchen",
    site: "juniper-kitchen",
    status: "provisioning",
    channel: "stable",
    pinned: null,
    current: null,
    previous: null,
  },
  {
    id: "sample-draft",
    name: "Moss & Mortar",
    site: "moss-mortar",
    status: "draft",
    channel: "stable",
    pinned: null,
    current: null,
    previous: null,
  },
];

export const isSampleId = (id: string) => id.startsWith("sample-");

/** The sample owners' names, for the admin's directory (#78). */
const SAMPLE_OWNER_NAMES = [
  "Asha Rao",
  "Tom Bell",
  "Mei Lin",
  "Ravi Menon",
  "Sara Holt",
  "Kofi Mensah",
  "Lena Novak",
];

/** A sample owner's name, or null for anyone else. */
export function sampleOwnerName(uid: string): string | null {
  const match = /^sample-owner-(\d+)$/.exec(uid);
  return match ? (SAMPLE_OWNER_NAMES[Number(match[1]) - 1] ?? null) : null;
}

/** The sample cafes, created `now`. */
export function sampleCafes(now: number): Cafe[] {
  return SPECS.map((spec, i) => ({
    id: spec.id,
    ownerUid: `sample-owner-${i + 1}`,
    ownerEmail: `owner${i + 1}@sample.test`,
    projectId: spec.status === "draft" ? null : `${spec.site}-1a2${i}`,
    site: spec.site,
    region: i % 2 === 0 ? "asia-south1" : "europe-west2",
    settings: newCafeSettings({ name: `${spec.name} (sample)` }),
    release: {
      channel: spec.channel,
      pinned: spec.pinned,
      current: spec.current,
      previous: spec.previous,
    },
    status: spec.status,
    createdAt: now - (30 - i * 3) * DAY,
    updatedAt: now - i * DAY,
  }));
}

/** The sample cafes' deployments: what each one has been through. */
export function sampleDeployments(now: number): Deployment[] {
  const owner = (cafeId: string) =>
    `sample-owner-${SPECS.findIndex((s) => s.id === cafeId) + 1}`;
  const make = (
    id: string,
    cafeId: string,
    over: {
      kind?: DeploymentKind;
      version: string | null;
      fromVersion?: string | null;
      status?: DeploymentStatus;
      trigger?: DeploymentTrigger;
      ago: number;
      took?: number;
      steps?: Deployment["steps"];
      error?: string | null;
    },
  ): Deployment => {
    const status = over.status ?? "succeeded";
    const active = status === "queued" || status === "running";
    return {
      id,
      cafeId,
      ownerUid: owner(cafeId),
      kind: over.kind ?? "deploy",
      version: over.version,
      fromVersion: over.fromVersion ?? null,
      status,
      trigger: over.trigger ?? "rollout",
      steps: over.steps ?? steps(7),
      error: over.error ?? null,
      createdAt: now - over.ago,
      finishedAt: active ? null : now - over.ago + (over.took ?? 50_000),
    };
  };
  return [
    make("sample-d01", "sample-harbour", {
      version: "1.1.1",
      fromVersion: "1.1.0",
      ago: 2 * HOUR,
    }),
    make("sample-d02", "sample-lamp", {
      version: "1.2.0-beta.1",
      fromVersion: "1.1.1",
      ago: 5 * HOUR,
      took: 75_000,
    }),
    make("sample-d03", "sample-orchard", {
      version: "1.1.1",
      fromVersion: "1.1.0",
      status: "rolled-back",
      ago: 2 * HOUR + 10 * MINUTE,
      took: 140_000,
      steps: steps(6, "failed"),
      error:
        "The smoke test failed on https://orchard-tea.web.app: /order answered 500 for 75 seconds. Rolled back: it runs CafeMenu 1.1.0 again.",
    }),
    make("sample-d04", "sample-tide", {
      version: "1.1.1",
      fromVersion: "1.1.0",
      status: "failed",
      ago: DAY,
      steps: steps(2, "failed"),
      error:
        "Access was removed: the deploy account can no longer reach tide-and-toast-1a24.",
    }),
    make("sample-d05", "sample-new", {
      kind: "provision",
      version: null,
      trigger: "admin",
      status: "running",
      ago: 4 * MINUTE,
      steps: [
        { id: "services", label: "Turn on Firebase services", status: "done" },
        { id: "database", label: "Create the database", status: "running" },
        { id: "rules", label: "Deploy the rules", status: "pending" },
        { id: "site", label: "Deploy the site", status: "pending" },
      ],
    }),
    make("sample-d06", "sample-harbour", {
      version: "1.1.0",
      fromVersion: "1.0.0",
      ago: 6 * DAY,
    }),
    make("sample-d07", "sample-harbour", {
      kind: "branding",
      version: "1.1.0",
      trigger: "owner",
      ago: 4 * DAY,
      steps: steps(0)
        .slice(4, 6)
        .map((s) => ({ ...s, status: "done" as const })),
    }),
    make("sample-d08", "sample-corner", {
      version: "1.0.0",
      fromVersion: null,
      trigger: "admin",
      ago: 12 * DAY,
    }),
    make("sample-d09", "sample-orchard", {
      version: "1.1.0",
      fromVersion: "1.0.0",
      ago: 6 * DAY + HOUR,
    }),
    make("sample-d10", "sample-orchard", {
      kind: "rollback",
      version: "1.0.0",
      fromVersion: "1.1.0",
      trigger: "owner",
      ago: 8 * DAY,
      steps: steps(0)
        .slice(2, 3)
        .map((s) => ({ ...s, status: "done" as const })),
    }),
    make("sample-d11", "sample-lamp", {
      version: "1.1.1",
      fromVersion: "1.1.0",
      ago: 7 * DAY,
    }),
    make("sample-d12", "sample-tide", {
      version: "1.1.0",
      fromVersion: "1.0.0",
      ago: 9 * DAY,
    }),
  ];
}

/** Rollouts the sample data implies: 1.1.1 finished, the beta under way. */
export const SAMPLE_ROLLOUTS: Record<string, RolloutStatus> = {
  "1.1.1": "completed",
  "1.2.0-beta.1": "running",
};

/** Emails the sample owners were sent, for the cafes' histories (#78). */
export function sampleEmails(now: number): DemoEmail[] {
  return [
    {
      id: "sample-e1",
      cafeId: "sample-harbour",
      kind: "release-available",
      at: now - 6 * DAY,
    },
    {
      id: "sample-e2",
      cafeId: "sample-orchard",
      kind: "deploy-failed",
      at: now - 2 * HOUR,
    },
    {
      id: "sample-e3",
      cafeId: "sample-orchard",
      kind: "maintenance-on",
      at: now - 10 * DAY,
    },
    {
      id: "sample-e4",
      cafeId: "sample-orchard",
      kind: "maintenance-off",
      at: now - 10 * DAY + 2 * HOUR,
    },
  ];
}

/** A past maintenance window on Orchard, in the admin log, by `admin`. */
export function sampleAdminLog(
  now: number,
  admin: { uid: string; email: string },
): AdminLogEntry[] {
  const entry = (
    id: string,
    action: string,
    at: number,
    reason: AdminLogEntry["reason"],
  ): AdminLogEntry => ({
    id,
    at,
    by: admin.uid,
    byEmail: admin.email,
    action,
    cafeId: "sample-orchard",
    ownerUid: "sample-owner-4",
    reason,
    details: {},
  });
  return [
    entry("sample-log-2", "maintenance-off", now - 10 * DAY + 2 * HOUR, {
      code: null,
      note: "Prices moved.",
    }),
    entry("sample-log-1", "maintenance-on", now - 10 * DAY, {
      code: "migration",
      note: "Moving prices to paise (#21).",
    }),
  ];
}

/** Adds the sample data, once: a second call finds it and does nothing. */
export function seedSample(state: DemoState, now = Date.now()) {
  if (state.cafes.some((c) => isSampleId(c.id))) return;
  state.cafes.push(...sampleCafes(now));
  state.deployments.push(...sampleDeployments(now));
  state.emails.push(...sampleEmails(now));
  const admin = state.accounts.find((a) => a.isAdmin);
  if (admin) state.adminLog.push(...sampleAdminLog(now, admin));
  for (const [version, status] of Object.entries(SAMPLE_ROLLOUTS)) {
    state.rollouts[version] ??= status;
  }
}

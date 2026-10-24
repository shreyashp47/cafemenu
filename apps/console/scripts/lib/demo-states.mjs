/**
 * Demo-mode states for screenshot.mjs and audit.mjs, so the pages behind a
 * step (the email check, onboarding) are looked at and audited too, not only
 * what a first visit shows. Each is the localStorage a browser would have at
 * that point: the demo store (src/lib/data/demo-store.ts) and the sign-up
 * draft (src/lib/signup/draft.ts), in the shapes those files parse.
 */

const DEMO_KEY = "cafemenu-console.demo.v1";
const DRAFT_KEY = "cafemenu-console.signup.v1";
const WIZARD_KEY = "cafemenu-console.setup.v1";
const OWNER = { uid: "owner-demo", email: "owner@lantern.test" };

const account = (emailVerified) => ({
  uid: OWNER.uid,
  email: OWNER.email,
  passwordHash: "00000000",
  emailVerified,
});

const form = {
  name: "Lantern Café",
  site: "lantern-cafe",
  siteEdited: false,
  email: OWNER.email,
  country: "IN",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  locale: "en-IN",
  region: "asia-south1",
  tables: "8",
  theme: "cozy",
  accent: null,
  logo: null,
  menu: { kind: "template", id: "coffee-shop" },
  menuText: "",
};

const demo = (accounts, cafes = [], deployments = []) =>
  JSON.stringify({ accounts, session: OWNER.uid, cafes, deployments });

/** A draft cafe as sign-up leaves it; settings missing here read as defaults. */
const cafe = (projectId = null) => ({
  id: "cafe-demo",
  ownerUid: OWNER.uid,
  ownerEmail: OWNER.email,
  projectId,
  site: "lantern-cafe",
  region: "asia-south1",
  settings: { schemaVersion: 2, name: "Lantern Café", tagline: "" },
  release: { channel: "stable", pinned: null, current: null, previous: null },
  status: "draft",
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
});

/** A live cafe on 1.1.0, as the owner area (#29) shows it. */
const liveCafe = () => ({
  ...cafe("lantern-cafe-1a2b"),
  settings: {
    schemaVersion: 2,
    name: "Lantern Café",
    tagline: "Slow coffee, warm lamps",
    theme: "cozy",
    currency: "INR",
    locale: "en-IN",
    timeZone: "Asia/Kolkata",
    tables: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  release: {
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: "1.0.0",
  },
  status: "live",
});

const DAY = 86_400_000;
const T0 = 1_790_000_000_000;
const step = (id, label, status) => ({ id, label, status });
const DEPLOY_STEPS = [
  ["package", "Fetch and verify the release package"],
  ["migrations", "Migrate the cafe's data"],
  ["rules", "Firestore rules"],
  ["indexes", "Firestore indexes"],
  ["settings", "Cafe settings"],
  ["hosting", "Hosting"],
  ["smoke", "Smoke test"],
];
const steps = (done, running = null) =>
  DEPLOY_STEPS.map(([id, label], i) =>
    step(id, label, i < done ? "done" : i === running ? "running" : "pending"),
  );
const deployment = (id, over) => ({
  id,
  cafeId: "cafe-demo",
  ownerUid: OWNER.uid,
  kind: "deploy",
  version: "1.1.0",
  fromVersion: "1.0.0",
  status: "succeeded",
  trigger: "owner",
  steps: steps(7),
  error: null,
  createdAt: T0,
  finishedAt: T0 + 40_000,
  ...over,
});

/** What the cafe has been through: a good upgrade and one that failed. */
const history = [
  deployment("dep-3", {
    kind: "branding",
    version: "1.1.0",
    fromVersion: null,
    steps: [
      step("settings", "Cafe settings", "done"),
      step("hosting", "Hosting", "done"),
    ],
    createdAt: T0 - DAY,
    finishedAt: T0 - DAY + 20_000,
  }),
  deployment("dep-2", {
    version: "1.1.1",
    fromVersion: "1.1.0",
    status: "rolled-back",
    trigger: "rollout",
    steps: steps(6).map((s) =>
      s.id === "smoke" ? { ...s, status: "failed" } : s,
    ),
    error: "The order page did not answer 200 after 75 seconds.",
    createdAt: T0 - 3 * DAY,
    finishedAt: T0 - 3 * DAY + 90_000,
  }),
  deployment("dep-1", {
    version: "1.1.0",
    fromVersion: "1.0.0",
    createdAt: T0 - 9 * DAY,
    finishedAt: T0 - 9 * DAY + 45_000,
  }),
];

const wizard = (step, projectId, result) =>
  JSON.stringify({
    "cafe-demo": {
      step,
      projectId,
      check: result
        ? { status: "answered", projectId, result, at: 1_790_000_000_000 }
        : null,
    },
  });

/** What `deployer check` names when the role is too small. */
const MISSING = {
  status: "missing",
  missing: [
    {
      permission: "datastore.databases.create",
      why: "create the Firestore database",
      neededBy: ["provision"],
    },
    {
      permission: "firebaseauth.configs.update",
      why: "turn on Email/Password and Anonymous sign-in",
      neededBy: ["provision"],
    },
  ],
};

/** localStorage for each named state. */
export const DEMO_STATES = {
  /** Signed up, the link not clicked yet, the form kept as a draft. */
  verify: {
    [DEMO_KEY]: demo([account(false)]),
    [DRAFT_KEY]: JSON.stringify({ form, email: OWNER.email, cafeId: null }),
  },
  /** Verified, the cafe saved as a draft: onboarding's first step. */
  project: {
    [DEMO_KEY]: demo([account(true)], [cafe()]),
  },
  /** At "Give CafeMenu access", after a check found the role too small. */
  access: {
    [DEMO_KEY]: demo([account(true)], [cafe("lantern-cafe-1a2b")]),
    [WIZARD_KEY]: wizard("access", "lantern-cafe-1a2b", MISSING),
  },
  /** The check passed. */
  connected: {
    [DEMO_KEY]: demo([account(true)], [cafe("lantern-cafe-1a2b")]),
    [WIZARD_KEY]: wizard("connected", "lantern-cafe-1a2b", {
      status: "connected",
    }),
  },
  /** A live cafe on 1.1.0 with 1.1.1 out, and a history that includes a failure. */
  owner: {
    [DEMO_KEY]: demo([account(true)], [liveCafe()], history),
  },
  /** The same cafe while an upgrade is running. */
  ownerRunning: {
    [DEMO_KEY]: demo(
      [account(true)],
      [liveCafe()],
      [
        deployment("dep-4", {
          version: "1.1.1",
          fromVersion: "1.1.0",
          status: "running",
          steps: steps(3, 3),
          createdAt: Date.now() - 20_000,
          finishedAt: null,
        }),
        ...history,
      ],
    ),
  },
};

/**
 * Puts a state in place before the page's own scripts run, or, with no
 * name, a clean browser: pages of one run share their storage, and what one
 * left must not change what the next one shows.
 */
export async function applyDemoState(page, name) {
  const state = name ? DEMO_STATES[name] : {};
  if (!state) throw new Error(`no demo state "${name}"`);
  await page.addInitScript((entries) => {
    // Only on the first load, so the page's own writes are not undone.
    if (sessionStorage.getItem("__demo_state__")) return;
    sessionStorage.setItem("__demo_state__", "1");
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, state);
}

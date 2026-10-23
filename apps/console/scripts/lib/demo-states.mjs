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

const demo = (accounts, cafes = []) =>
  JSON.stringify({ accounts, session: OWNER.uid, cafes, deployments: [] });

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

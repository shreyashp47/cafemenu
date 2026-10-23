/**
 * Demo-mode states for screenshot.mjs and audit.mjs, so the pages behind a
 * step (the email check, onboarding) are looked at and audited too, not only
 * what a first visit shows. Each is the localStorage a browser would have at
 * that point: the demo store (src/lib/data/demo-store.ts) and the sign-up
 * draft (src/lib/signup/draft.ts), in the shapes those files parse.
 */

const DEMO_KEY = "cafemenu-console.demo.v1";
const DRAFT_KEY = "cafemenu-console.signup.v1";
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

const demo = (accounts) =>
  JSON.stringify({ accounts, session: OWNER.uid, cafes: [], deployments: [] });

/** localStorage for each named state. */
export const DEMO_STATES = {
  /** Signed up, the link not clicked yet, the form kept as a draft. */
  verify: {
    [DEMO_KEY]: demo([account(false)]),
    [DRAFT_KEY]: JSON.stringify({ form, email: OWNER.email, cafeId: null }),
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

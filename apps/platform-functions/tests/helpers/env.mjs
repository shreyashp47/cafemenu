/**
 * An `env` (src/runtime.mjs) for tests: the deployer's fake Google and the
 * fake GitHub behind it, the platform's data in memory, a clock that only
 * moves when something sleeps, and the stand-in for @cafemenu/shared that
 * the deployer's own tests use on Node 20.
 */
import {
  PROJECT,
  createFakeGoogle,
  freshState,
} from "../../../../packages/deployer/tests/helpers/fake-google.mjs";
import {
  PNG,
  SETTINGS,
  SITE,
  fakeShared,
  publish,
  releasePackage,
} from "../../../../packages/deployer/tests/helpers/release.mjs";
import { CLIENT_EMAIL } from "../../../../packages/deployer/tests/helpers/setup.mjs";
import { createGoogleSide } from "../../src/runtime.mjs";
import { createMemoryStore } from "./memory-store.mjs";

export { CLIENT_EMAIL, PNG, PROJECT, SETTINGS, SITE };

export const shared = Object.freeze({
  ...fakeShared,
  MENU_TEXT_LIMITS: { name: 60, category: 40, description: 200 },
  MAX_IMPORT_ROWS: 200,
});

export const OWNER = { uid: "owner1", email: "owner@example.com" };
export const CAFE_ID = "cafe1";

/** A cafe as the console leaves it after sign-up and "Check connection". */
export const draftCafe = (overrides = {}) => ({
  id: CAFE_ID,
  ownerUid: OWNER.uid,
  ownerEmail: OWNER.email,
  projectId: PROJECT,
  site: SITE,
  region: "asia-south1",
  settings: { ...SETTINGS },
  release: { channel: "stable", pinned: null, current: null, previous: null },
  status: "draft",
  ...overrides,
});

export const MENU = {
  source: "template",
  template: "coffee-shop",
  currency: "INR",
  items: [
    {
      name: "Masala chai",
      category: "Tea",
      description: "Ginger and cardamom",
      price: 6000,
      available: true,
    },
    {
      name: "Filter coffee",
      category: "Coffee",
      description: "",
      price: 8000,
      available: false,
    },
  ],
};

/** A callable's request, as Firebase hands it over. */
export const call = (data, who = OWNER, claims = {}) => ({
  auth: {
    uid: who.uid,
    token: { email: who.email, email_verified: true, ...claims },
  },
  data,
});

export async function testEnv({ releases = ["1.0.0"], state } = {}) {
  const store = createMemoryStore();
  const fake = createFakeGoogle({ state: state ?? freshState() });
  let clock = Date.UTC(2026, 9, 1);
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const now = () => new Date(clock);
  const logs = [];
  const outbox = [];
  const mail = {
    sender: {
      name: "test",
      send: async (email) => {
        if (mail.failWith) throw new Error(mail.failWith);
        outbox.push(email);
        return { id: `mail-${outbox.length}` };
      },
    },
    consoleUrl: "https://console.example",
    unsubscribeUrl: "https://platform.example/unsubscribe",
  };
  const google = createGoogleSide({
    getToken: async () => "fake-token-1",
    fetchImpl: fake.fetchImpl,
    clientEmail: CLIENT_EMAIL,
    sleep,
    now,
    loadShared: async () => shared,
  });
  const packages = {};
  for (const version of releases) {
    packages[version] = await releasePackage(version);
    await publish(fake, packages[version]);
    store.addRelease({
      version,
      channel: version.includes("-") ? "beta" : "stable",
      withdrawn: false,
      schemaVersion: 1,
    });
  }
  return {
    env: {
      store,
      google,
      mail,
      loadShared: async () => shared,
      now,
      sleep,
      log: (level, message, fields) => logs.push({ level, message, ...fields }),
    },
    mail,
    outbox,
    store,
    fake,
    state: fake.state,
    packages,
    logs,
    sleeps,
    advance: (ms) => {
      clock += ms;
    },
  };
}

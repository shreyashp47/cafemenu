/**
 * Behavioural test for firestore.rules (the platform database), run against
 * the Firestore + Auth emulators, in the style of apps/cafe/scripts/rules-test.mjs.
 *
 * The rules are the only thing between one cafe owner and another's records,
 * and between owners and the fields only the deployer may write. They are not
 * TypeScript, so nothing else checks them. Every rule has a case here, and a
 * denial must be the rules saying no (permission-denied), never some other
 * failure.
 *
 * It drives the real client SDK, signed in as real emulator accounts, because
 * `createdAt == request.time` can only be met with serverTimestamp(), and the
 * difference between a verified owner, an unverified one and the admin is in
 * their ID tokens.
 *
 *   npm run emulators            # terminal 1
 *   npm run test:rules           # terminal 2
 *
 * or in one command, which starts and stops the emulators itself:
 *
 *   firebase emulators:exec --only auth,firestore --project demo-cafemenu "npm run test:rules"
 *
 * The emulators need Java 21+. Each run starts by wiping the emulators' data
 * and accounts, so it never depends on what a previous run left. It refuses a
 * project ID that does not start with "demo-": those never reach a real
 * Firebase project.
 */
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  addDoc,
  Bytes,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT = process.env.FIRESTORE_EMULATOR_PROJECT ?? "demo-cafemenu";
if (!PROJECT.startsWith("demo-")) {
  console.error(`refusing to run against "${PROJECT}": not a demo- project`);
  process.exit(2);
}
// `firebase emulators:exec` exports these as "host:port".
const [fsEnvHost, fsEnvPort] = (
  process.env.FIRESTORE_EMULATOR_HOST ?? ""
).split(":");
const [, authEnvPort] = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "").split(
  ":",
);
const HOST = fsEnvHost || "127.0.0.1";
const FS_PORT = Number(fsEnvPort || 8180);
const AUTH_PORT = Number(authEnvPort || 9199);
const CFG = { projectId: PROJECT, apiKey: "demo", authDomain: "demo.local" };
// Every denial below would otherwise also be logged by the SDK as a warning.
// The test checks each one's code itself.
setLogLevel("silent");

const FS_ADMIN = `http://${HOST}:${FS_PORT}`;
const AUTH_ADMIN = `http://${HOST}:${AUTH_PORT}`;
// The emulators accept this as the project's admin, which bypasses the rules:
// how the backend's own writes are stood in for.
const ADMIN_HEADERS = {
  Authorization: "Bearer owner",
  "Content-Type": "application/json",
};

let pass = 0;
const failures = [];
async function t(label, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok    ${label}`);
  } catch (e) {
    const msg = String(e?.message ?? e)
      .split("\n")[0]
      .trim()
      .slice(0, 64);
    failures.push(label);
    console.log(`  FAIL  ${label}  -> ${msg}`);
  }
}
// A denial has to be the rules saying no. Accepting any error would let a
// broken setup step pass as "denied" while testing nothing.
const denied = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    if (e?.code === "permission-denied") return;
    throw new Error(
      `failed, but not with permission-denied: ${e?.code ?? ""} ${String(
        e?.message ?? e,
      )
        .split("\n")[0]
        .slice(0, 40)}`,
    );
  }
  throw new Error("was ALLOWED but should have been denied");
};
const allowed = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    throw new Error(
      `was DENIED: ${String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 50)}`,
    );
  }
};
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

// -- a clean slate ----------------------------------------------------------

const wipe = async (url) => {
  const res = await fetch(url, { method: "DELETE", headers: ADMIN_HEADERS });
  if (!res.ok) throw new Error(`could not wipe ${url}: ${res.status}`);
};
await wipe(
  `${FS_ADMIN}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
);
await wipe(`${AUTH_ADMIN}/emulator/v1/projects/${PROJECT}/accounts`);

// -- accounts -----------------------------------------------------------------

const PASSWORD = "correct-horse";
async function account(email, { verified = false, admin = false } = {}) {
  const res = await fetch(
    `${AUTH_ADMIN}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  ).then((r) => r.json());
  if (!res.localId) {
    throw new Error(`could not create ${email}: ${JSON.stringify(res)}`);
  }
  // What clicking the verification link and the backend's setCustomUserClaims
  // do, done as the emulator's admin.
  const update = await fetch(
    `${AUTH_ADMIN}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
    {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        localId: res.localId,
        emailVerified: verified,
        ...(admin ? { customAttributes: JSON.stringify({ admin: true }) } : {}),
      }),
    },
  );
  if (!update.ok) {
    throw new Error(`could not set up ${email}: ${await update.text()}`);
  }
  return { uid: res.localId, email };
}

const client = (name) => {
  const a = initializeApp(CFG, name);
  const auth = getAuth(a);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  const db = getFirestore(a);
  connectFirestoreEmulator(db, HOST, FS_PORT);
  return { a, auth, db };
};
const signedInAs = async (name, acct) => {
  const c = client(name);
  await signInWithEmailAndPassword(c.auth, acct.email, PASSWORD);
  return { ...c, ...acct };
};

const ALICE = await account("alice@owner.test", { verified: true });
const BOB = await account("bob@owner.test", { verified: true });
const CAROL = await account("carol@owner.test", { verified: true });
const DAVE = await account("dave@owner.test"); // never clicked the link
const LAPSED = await account("lapsed@owner.test"); // owns a cafe, unverified
const ERIN = await account("erin@platform.test", {
  verified: true,
  admin: true,
});
const FRANK = await account("frank@platform.test", { admin: true }); // unverified

const alice = await signedInAs("alice", ALICE);
const bob = await signedInAs("bob", BOB);
const carol = await signedInAs("carol", CAROL);
const dave = await signedInAs("dave", DAVE);
const lapsed = await signedInAs("lapsed", LAPSED);
const erin = await signedInAs("erin", ERIN);
const frank = await signedInAs("frank", FRANK);
const nobody = client("nobody");
const anon = client("anonymous");
await signInAnonymously(anon.auth);
const everyone = [alice, bob, carol, dave, lapsed, erin, frank, nobody, anon];

// -- what the backend has written -------------------------------------------

const toValue = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, toValue(x)]),
      ),
    },
  };
};
// PATCH with the admin token: the emulator's REST layer refuses POST to a path
// with an explicit id, and a seed that silently fails would make every test
// below meaningless.
const seed = async (path, data) => {
  const res = await fetch(
    `${FS_ADMIN}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ fields: toValue(data).mapValue.fields }),
    },
  );
  if (!res.ok) throw new Error(`could not seed ${path}: ${await res.text()}`);
};

const WHEN = new Date("2026-10-01T09:00:00Z");
// DEFAULT_SETTINGS from @cafemenu/shared (packages/shared/src/settings.ts),
// written out because this script is plain Node and cannot import TypeScript.
const settings = (o = {}) => ({
  schemaVersion: 2,
  name: "Mochi & Beans",
  tagline: "Good Coffee, Better Days",
  theme: "cozy",
  accent: null,
  logo: null,
  currency: "INR",
  locale: "en-IN",
  moneyUnit: "minor",
  maxOrderTotal: 1_000_000,
  timeZone: "Asia/Kolkata",
  utcOffsets: { standard: 330, daylight: 330 },
  tables: [1, 2, 3, 4, 5, 6],
  baseUrl: null,
  plan: "free",
  ...o,
});
const cafeRecord = (owner, o = {}) => ({
  ownerUid: owner.uid,
  ownerEmail: owner.email,
  projectId: `${owner.email.split("@")[0]}-cafe`,
  site: `${owner.email.split("@")[0]}-cafe`,
  region: "asia-south1",
  settings: settings({ name: "A Cafe" }),
  release: {
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: "1.0.0",
  },
  status: "live",
  createdAt: WHEN,
  updatedAt: WHEN,
  ...o,
});
await seed("cafes/cafe-a", cafeRecord(ALICE));
await seed(
  "cafes/cafe-a-draft",
  cafeRecord(ALICE, {
    projectId: null,
    site: "alice-second",
    status: "draft",
    release: { channel: "stable", pinned: null, current: null, previous: null },
  }),
);
await seed("cafes/cafe-b", cafeRecord(BOB));
await seed("cafes/cafe-l", cafeRecord(LAPSED));
await seed("releases/1.1.0", {
  channel: "stable",
  notes: "Fixes.",
  publishedAt: WHEN,
  schemaVersion: 2,
  withdrawn: false,
});
await seed("releases/1.0.0", {
  channel: "stable",
  notes: "First.",
  publishedAt: WHEN,
  schemaVersion: 1,
  withdrawn: false,
});
const deployment = (owner, cafeId, o = {}) => ({
  cafeId,
  ownerUid: owner.uid,
  kind: "deploy",
  version: "1.1.0",
  fromVersion: "1.0.0",
  status: "running",
  trigger: "rollout",
  steps: [{ id: "rules", label: "Deploy the rules", status: "running" }],
  error: null,
  createdAt: WHEN,
  finishedAt: null,
  ...o,
});
await seed("deployments/dep-a", deployment(ALICE, "cafe-a"));
await seed("deployments/dep-b", deployment(BOB, "cafe-b"));
// What apps/platform-functions keeps about a cafe's releases (hosting versions,
// rules): the backend's, with no rule that lets anyone else near it.
await seed("cafes/cafe-a/private/deployRecord", {
  site: "cafe-a",
  current: null,
  previous: null,
  schemaFloor: 1,
});

// -- helpers ------------------------------------------------------------------

/** A copy of `o` with no `key`, for "missing field" cases. */
const without = (o, key) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const cafe = (c, id) => doc(c.db, "cafes", id);
const mine = (c, uid = c.uid) =>
  getDocs(query(collection(c.db, "cafes"), where("ownerUid", "==", uid)));
const allCafes = (c) => getDocs(collection(c.db, "cafes"));
// Mirrors newCafeRecord() in src/lib/platform/records.ts: what the console's
// sign-up writes.
const newCafe = (c, o = {}) => ({
  ownerUid: c.uid,
  ownerEmail: c.email,
  projectId: null,
  site: "carols-cafe",
  region: "asia-south1",
  settings: settings({ name: "Carol's" }),
  release: { channel: "stable", pinned: null, current: null, previous: null },
  status: "draft",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...o,
});
const create = (c, o) => addDoc(collection(c.db, "cafes"), newCafe(c, o));
// An owner's edit, as the console makes it: field paths plus updatedAt.
const edit = (c, id, patch) =>
  updateDoc(cafe(c, id), { ...patch, updatedAt: serverTimestamp() });
const release = (c, version) => doc(c.db, "releases", version);
const deploy = (c, id) => doc(c.db, "deployments", id);
const myDeployments = (c, cafeId) =>
  getDocs(
    query(
      collection(c.db, "deployments"),
      where("ownerUid", "==", c.uid),
      where("cafeId", "==", cafeId),
    ),
  );

console.log(`\nfirestore.rules vs the emulators (${PROJECT})\n`);

// -- strangers ------------------------------------------------------------------

console.log(" signed-out visitor and anonymous caller");
for (const [who, c] of [
  ["signed out", nobody],
  ["anonymous", anon],
]) {
  await t(
    `${who}: cannot read a cafe`,
    denied(() => getDoc(cafe(c, "cafe-a"))),
  );
  await t(
    `${who}: cannot list cafes`,
    denied(() => allCafes(c)),
  );
  await t(
    `${who}: cannot read releases`,
    denied(() => getDocs(collection(c.db, "releases"))),
  );
  await t(
    `${who}: cannot read a deployment`,
    denied(() => getDoc(deploy(c, "dep-a"))),
  );
}
await t(
  "anonymous: cannot create a cafe, even one shaped right",
  denied(() => create({ ...anon, uid: anon.auth.currentUser.uid, email: "" })),
);

// -- reading cafes ---------------------------------------------------------------

console.log("\n owners reading cafes");
await t(
  "owner A reads their own cafe",
  allowed(() => getDoc(cafe(alice, "cafe-a"))),
);
await t(
  "owner A cannot read owner B's cafe",
  denied(() => getDoc(cafe(alice, "cafe-b"))),
);
await t(
  "owner B cannot read owner A's cafe",
  denied(() => getDoc(cafe(bob, "cafe-a"))),
);
await t(
  "owner A lists their own cafes, and gets only theirs",
  allowed(async () => {
    const snap = await mine(alice);
    expect(snap.size === 2, `expected 2 cafes, got ${snap.size}`);
    expect(
      snap.docs.every((d) => d.data().ownerUid === ALICE.uid),
      "a cafe of someone else came back",
    );
  }),
);
await t(
  "owner A cannot list every cafe",
  denied(() => allCafes(alice)),
);
await t(
  "owner A cannot list owner B's cafes by asking for them",
  denied(() => mine(alice, BOB.uid)),
);
await t(
  "an unverified owner still reads their own cafe",
  allowed(() => getDoc(cafe(lapsed, "cafe-l"))),
);
await t(
  "an unverified account cannot read anyone else's",
  denied(() => getDoc(cafe(dave, "cafe-a"))),
);

// -- creating cafes ----------------------------------------------------------------

console.log("\n signing a cafe up");
await t(
  "a verified owner creates a draft cafe",
  allowed(() => create(carol)),
);
await t(
  "…with a project, on beta, staying on 1.1",
  allowed(() =>
    create(carol, {
      projectId: "carols-cafe-1a2b3",
      site: "carols-other-cafe",
      release: {
        channel: "beta",
        pinned: "1.1",
        current: null,
        previous: null,
      },
    }),
  ),
);
await t(
  "an unverified account cannot create a cafe",
  denied(() => create(dave)),
);
await t(
  "cannot create a cafe for someone else",
  denied(() => create(carol, { ownerUid: BOB.uid })),
);
await t(
  "cannot create a cafe under someone else's email",
  denied(() => create(carol, { ownerEmail: BOB.email })),
);
await t(
  "cannot create a cafe that is already live",
  denied(() => create(carol, { status: "live" })),
);
await t(
  "cannot create a cafe already on a release (current)",
  denied(() =>
    create(carol, {
      release: {
        channel: "stable",
        pinned: null,
        current: "1.1.0",
        previous: null,
      },
    }),
  ),
);
await t(
  "cannot create a cafe with a rollback target (previous)",
  denied(() =>
    create(carol, {
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: "1.0.0",
      },
    }),
  ),
);
await t(
  "cannot slip an extra key into release",
  denied(() =>
    create(carol, {
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
        target: "9.9.9",
      },
    }),
  ),
);
await t(
  "cannot create a cafe with an extra field (plan)",
  denied(() => create(carol, { plan: "pro" })),
);
await t(
  "cannot create a cafe missing a field (projectId)",
  denied(() =>
    addDoc(collection(carol.db, "cafes"), without(newCafe(carol), "projectId")),
  ),
);
await t(
  "cannot create on an unknown channel",
  denied(() =>
    create(carol, {
      release: {
        channel: "nightly",
        pinned: null,
        current: null,
        previous: null,
      },
    }),
  ),
);
await t(
  "cannot pin to something that is not a minor line",
  denied(() =>
    create(carol, {
      release: {
        channel: "stable",
        pinned: "latest",
        current: null,
        previous: null,
      },
    }),
  ),
);
for (const site of [
  "Carols-Cafe",
  "carols_cafe",
  "-carols",
  "carols-",
  "a".repeat(31),
]) {
  await t(
    `cannot create with site name "${site.length > 12 ? `${site.slice(0, 6)}… (${site.length})` : site}"`,
    denied(() => create(carol, { site })),
  );
}
await t(
  "…with its database in a multi-region (nam5)",
  allowed(() => create(carol, { site: "carols-us", region: "nam5" })),
);
await t(
  "cannot create a cafe missing a field (region)",
  denied(() =>
    addDoc(collection(carol.db, "cafes"), without(newCafe(carol), "region")),
  ),
);
for (const region of ["Asia-South1", "asia south 1", "asia-south", "", null]) {
  await t(
    `cannot create with region ${JSON.stringify(region)}`,
    denied(() => create(carol, { region })),
  );
}
await t(
  "cannot create with a malformed project ID",
  denied(() => create(carol, { projectId: "Carols_Project" })),
);
await t(
  "cannot create with settings that are not a map",
  denied(() => create(carol, { settings: "Carol's" })),
);
await t(
  "cannot create with a setting missing (currency)",
  denied(() => create(carol, { settings: without(settings(), "currency") })),
);
await t(
  "cannot create with a setting that does not exist",
  denied(() => create(carol, { settings: settings({ admin: true }) })),
);
for (const [what, bad] of [
  ["an empty name", { name: "" }],
  ["a 61-character name", { name: "x".repeat(61) }],
  ["a lower-case currency", { currency: "inr" }],
  ["a colour that is not #RRGGBB", { accent: "red" }],
  ["table 51", { tables: [1, 51] }],
  ["no tables", { tables: [] }],
  ["a base URL with a path", { baseUrl: "https://their-cafe.web.app/order" }],
  ["offsets as text", { utcOffsets: { standard: "330", daylight: 330 } }],
  ["schema version 0", { schemaVersion: 0 }],
  ["a money unit it does not know", { moneyUnit: "paise" }],
  ["an order cap of 0", { maxOrderTotal: 0 }],
  ["an order cap in decimals", { maxOrderTotal: 99.5 }],
]) {
  await t(
    `cannot create with ${what} in the settings`,
    denied(() => create(carol, { settings: settings(bad) })),
  );
}
await t(
  "cannot create a cafe in whole units (#12: new cafes are in minor units)",
  denied(() => create(carol, { settings: settings({ moneyUnit: "major" }) })),
);
await t(
  "cannot create a cafe on a paid plan",
  denied(() => create(carol, { settings: settings({ plan: "pro" }) })),
);
await t(
  "settings may name a theme a newer release has",
  allowed(() =>
    create(carol, {
      site: "carols-themed",
      settings: settings({ theme: "minimal", accent: "#1D6A51" }),
    }),
  ),
);
await t(
  "cannot backdate a cafe (createdAt from the client)",
  denied(() => create(carol, { createdAt: Timestamp.now() })),
);
await t(
  "cannot take over an existing cafe by writing its id",
  denied(() => setDoc(cafe(carol, "cafe-b"), newCafe(carol))),
);

// -- owners editing their cafe ------------------------------------------------------

console.log("\n owners editing their cafe");
await t(
  "owner A changes their cafe's settings",
  allowed(() =>
    edit(alice, "cafe-a", {
      settings: settings({ name: "Alice's", currency: "EUR", locale: "en-IE" }),
    }),
  ),
);
await t(
  "owner A cannot put their cafe on a paid plan",
  denied(() => edit(alice, "cafe-a", { settings: settings({ plan: "pro" }) })),
);
await seed(
  "cafes/cafe-pro",
  cafeRecord(ALICE, { site: "alice-pro", settings: settings({ plan: "pro" }) }),
);
await t(
  "owner A cannot move a cafe off the plan the backend gave it",
  denied(() => edit(alice, "cafe-pro", { settings: settings() })),
);
await t(
  "…but edits its other settings, plan unchanged",
  allowed(() =>
    edit(alice, "cafe-pro", {
      settings: settings({ name: "Pro", plan: "pro" }),
    }),
  ),
);
await t(
  "owner A sets their own order cap",
  allowed(() =>
    edit(alice, "cafe-a", { settings: settings({ maxOrderTotal: 500_000 }) }),
  ),
);
await t(
  "owner A cannot change what their stored prices count (a migration's job)",
  denied(() =>
    edit(alice, "cafe-a", { settings: settings({ moneyUnit: "major" }) }),
  ),
);
{
  // Records from before #12: version 1 settings, no unit, whole units.
  const before = settings({ schemaVersion: 1 });
  delete before.moneyUnit;
  delete before.maxOrderTotal;
  for (const id of ["cafe-toe", "cafe-toe-2"]) {
    await seed(
      `cafes/${id}`,
      cafeRecord(ALICE, { site: id, settings: before }),
    );
  }
  await t(
    "a cafe from before #12 is saved in whole units, as its data is",
    allowed(() =>
      edit(alice, "cafe-toe", {
        settings: settings({ moneyUnit: "major", maxOrderTotal: 10_000 }),
      }),
    ),
  );
  await t(
    "…and not switched to minor units by the owner",
    denied(() =>
      edit(alice, "cafe-toe-2", { settings: settings({ moneyUnit: "minor" }) }),
    ),
  );
}
await t(
  "owner A cannot change one setting to something invalid",
  denied(() => edit(alice, "cafe-a", { "settings.tables": [0] })),
);
await t(
  "owner A cannot remove a setting",
  denied(() =>
    edit(alice, "cafe-a", { settings: without(settings(), "tagline") }),
  ),
);
await t(
  "owner A switches to beta",
  allowed(() => edit(alice, "cafe-a", { "release.channel": "beta" })),
);
await t(
  "owner A stays on 1.1",
  allowed(() => edit(alice, "cafe-a", { "release.pinned": "1.1" })),
);
await t(
  "owner A follows new versions again (no pin), on stable",
  allowed(() =>
    edit(alice, "cafe-a", {
      "release.pinned": null,
      "release.channel": "stable",
    }),
  ),
);
await t(
  "owner A cannot change release.current",
  denied(() => edit(alice, "cafe-a", { "release.current": "9.9.9" })),
);
await t(
  "owner A cannot clear release.current",
  denied(() => edit(alice, "cafe-a", { "release.current": null })),
);
await t(
  "owner A cannot change release.previous",
  denied(() => edit(alice, "cafe-a", { "release.previous": "0.9.0" })),
);
await t(
  "owner A cannot add a key to release",
  denied(() => edit(alice, "cafe-a", { "release.target": "9.9.9" })),
);
await t(
  "owner A cannot replace release wholesale with a new current",
  denied(() =>
    edit(alice, "cafe-a", {
      release: {
        channel: "stable",
        pinned: null,
        current: "9.9.9",
        previous: "1.1.0",
      },
    }),
  ),
);
await t(
  "owner A cannot pin to a non-minor-line",
  denied(() => edit(alice, "cafe-a", { "release.pinned": "1.x" })),
);
await t(
  "owner A cannot pick an unknown channel",
  denied(() => edit(alice, "cafe-a", { "release.channel": "nightly" })),
);
await t(
  "owner A cannot change the status",
  denied(() => edit(alice, "cafe-a", { status: "suspended" })),
);
await t(
  "owner A cannot mark a draft live",
  denied(() => edit(alice, "cafe-a-draft", { status: "live" })),
);
await t(
  "owner A cannot hand the cafe to someone else",
  denied(() => edit(alice, "cafe-a", { ownerUid: BOB.uid })),
);
await t(
  "owner A cannot change the owner email",
  denied(() => edit(alice, "cafe-a", { ownerEmail: "someone@else.test" })),
);
await t(
  "owner A cannot switch the release emails off or on (the backend's unsubscribe link does)",
  denied(() => edit(alice, "cafe-a", { emails: { releaseNotices: false } })),
);
await t(
  "owner A cannot rewrite createdAt",
  denied(() => edit(alice, "cafe-a", { createdAt: serverTimestamp() })),
);
await t(
  "owner A cannot add a field (plan)",
  denied(() => edit(alice, "cafe-a", { plan: "pro" })),
);
await t(
  "an edit must stamp updatedAt with the server time",
  denied(() =>
    updateDoc(cafe(alice, "cafe-a"), {
      settings: settings({ name: "x" }),
      updatedAt: Timestamp.now(),
    }),
  ),
);
await t(
  "owner A cannot change the project of a live cafe",
  denied(() => edit(alice, "cafe-a", { projectId: "other-project" })),
);
await t(
  "owner A cannot change the site of a live cafe",
  denied(() => edit(alice, "cafe-a", { site: "other-site" })),
);
await t(
  "owner A connects a project to their draft cafe",
  allowed(() =>
    edit(alice, "cafe-a-draft", { projectId: "alice-second-1a2b" }),
  ),
);
await t(
  "owner A renames the site of their draft cafe",
  allowed(() => edit(alice, "cafe-a-draft", { site: "alice-two" })),
);
await t(
  "…but not to a malformed project ID",
  denied(() => edit(alice, "cafe-a-draft", { projectId: "Not A Project" })),
);
await t(
  "owner A moves the database of their draft cafe to another region",
  allowed(() => edit(alice, "cafe-a-draft", { region: "europe-west2" })),
);
await t(
  "…but not to a malformed one",
  denied(() => edit(alice, "cafe-a-draft", { region: "Europe West 2" })),
);
await t(
  "owner A cannot move the database of a live cafe",
  denied(() => edit(alice, "cafe-a", { region: "europe-west2" })),
);
{
  // A record from before sign-up asked for the region.
  await seed("cafes/cafe-no-region", without(cafeRecord(ALICE), "region"));
  await t(
    "a live cafe with no region still has its settings edited",
    allowed(() =>
      edit(alice, "cafe-no-region", { settings: settings({ name: "Old" }) }),
    ),
  );
  await t(
    "…but is not given a region by the owner once live",
    denied(() => edit(alice, "cafe-no-region", { region: "asia-south1" })),
  );
}
await t(
  "owner B cannot edit owner A's cafe",
  denied(() =>
    edit(bob, "cafe-a", { settings: settings({ name: "Bob's now" }) }),
  ),
);
await t(
  "owner B cannot change owner A's release choice",
  denied(() => edit(bob, "cafe-a", { "release.channel": "beta" })),
);
await t(
  "an unverified owner cannot edit their own cafe",
  denied(() => edit(lapsed, "cafe-l", { settings: settings({ name: "x" }) })),
);
await t(
  "owner A cannot delete their cafe",
  denied(() => deleteDoc(cafe(alice, "cafe-a"))),
);

// -- what the owner gives at sign-up --------------------------------------------

console.log("\n the logo and starting menu of a draft cafe");
// A PNG's first bytes, then filler: the rules check the type and the size;
// only the console and the deployer look inside.
const png = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return Bytes.fromUint8Array(bytes);
};
const setupDoc = (c, cafeId, part) => doc(c.db, "cafes", cafeId, "setup", part);
const putLogo = (c, cafeId, o = {}) =>
  setDoc(setupDoc(c, cafeId, "logo"), {
    png: png(2048),
    updatedAt: serverTimestamp(),
    ...o,
  });
const item = (name) => ({
  name,
  category: "Coffee",
  description: "",
  price: 18000,
  available: true,
});
const putMenu = (c, cafeId, o = {}) =>
  setDoc(setupDoc(c, cafeId, "menu"), {
    source: "template",
    template: "coffee-shop",
    currency: "INR",
    items: [item("Flat White"), item("Espresso")],
    updatedAt: serverTimestamp(),
    ...o,
  });
await seed(
  "cafes/cafe-l-draft",
  cafeRecord(LAPSED, {
    projectId: null,
    site: "lapsed-draft",
    status: "draft",
    release: { channel: "stable", pinned: null, current: null, previous: null },
  }),
);
await t(
  "owner A saves a logo for their draft cafe",
  allowed(() => putLogo(alice, "cafe-a-draft")),
);
await t(
  "…replaces it",
  allowed(() => putLogo(alice, "cafe-a-draft", { png: png(4096) })),
);
await t(
  "…and reads it back",
  allowed(async () => {
    const snap = await getDoc(setupDoc(alice, "cafe-a-draft", "logo"));
    expect(snap.data()?.png?.toUint8Array().length === 4096, "wrong bytes");
  }),
);
await t(
  "a logo of 750 000 bytes fits",
  allowed(() => putLogo(alice, "cafe-a-draft", { png: png(750_000) })),
);
await t(
  "a logo of 750 001 bytes does not",
  denied(() => putLogo(alice, "cafe-a-draft", { png: png(750_001) })),
);
await t(
  "a logo must be bytes, not text",
  denied(() => putLogo(alice, "cafe-a-draft", { png: "iVBORw0KGgo=" })),
);
await t(
  "a logo cannot carry another field",
  denied(() => putLogo(alice, "cafe-a-draft", { url: "https://x.test/l.png" })),
);
await t(
  "a logo must be stamped with the server time",
  denied(() => putLogo(alice, "cafe-a-draft", { updatedAt: Timestamp.now() })),
);
await t(
  "owner A saves a starter menu",
  allowed(() => putMenu(alice, "cafe-a-draft")),
);
await t(
  "…or a pasted one",
  allowed(() =>
    putMenu(alice, "cafe-a-draft", { source: "import", template: null }),
  ),
);
await t(
  "…or a blank one, with no rows",
  allowed(() =>
    putMenu(alice, "cafe-a-draft", {
      source: "blank",
      template: null,
      items: [],
    }),
  ),
);
await t(
  "…and 200 rows, the most an import takes",
  allowed(() =>
    putMenu(alice, "cafe-a-draft", {
      items: Array.from({ length: 200 }, (_, i) => item(`Item ${i}`)),
    }),
  ),
);
await t(
  "a menu of 201 rows is refused",
  denied(() =>
    putMenu(alice, "cafe-a-draft", {
      items: Array.from({ length: 201 }, (_, i) => item(`Item ${i}`)),
    }),
  ),
);
for (const [what, bad] of [
  ["a blank menu with rows", { source: "blank", template: null }],
  ["a starter with no rows", { items: [] }],
  ["a starter with no template", { template: null }],
  ["a pasted menu naming a template", { source: "import" }],
  ["a template id that is not one", { template: "Coffee Shop!" }],
  ["an unknown source", { source: "ai", template: null }],
  ["rows that are not a list", { items: { a: item("Latte") } }],
  ["prices in another currency than the cafe's", { currency: "USD" }],
  ["an extra field", { publish: true }],
  ["a client timestamp", { updatedAt: Timestamp.now() }],
]) {
  await t(
    `cannot save ${what}`,
    denied(() => putMenu(alice, "cafe-a-draft", bad)),
  );
}
await t(
  "the menu cannot be deleted, only replaced",
  denied(() => deleteDoc(setupDoc(alice, "cafe-a-draft", "menu"))),
);
await t(
  "the logo can be deleted",
  allowed(() => deleteDoc(setupDoc(alice, "cafe-a-draft", "logo"))),
);
await t(
  "nothing else lives under setup",
  denied(() =>
    setDoc(setupDoc(alice, "cafe-a-draft", "payment"), {
      card: "4242",
      updatedAt: serverTimestamp(),
    }),
  ),
);
await t(
  "once setup has started the menu is fixed (live cafe: menu)",
  denied(() => putMenu(alice, "cafe-a")),
);
// The owner area replaces a live cafe's logo, for the backend to deploy.
await t(
  "…but a live cafe's logo can be replaced",
  allowed(() => putLogo(alice, "cafe-a")),
);
await t(
  "…and dropped",
  allowed(() => deleteDoc(setupDoc(alice, "cafe-a", "logo"))),
);
await t(
  "…and the logo is still checked (not text)",
  denied(() => putLogo(alice, "cafe-a", { png: "not bytes" })),
);
await t(
  "…and still has to be stamped with the server time",
  denied(() => putLogo(alice, "cafe-a", { updatedAt: Timestamp.now() })),
);
await t(
  "owner B cannot replace owner A's live cafe's logo",
  denied(() => putLogo(bob, "cafe-a")),
);
await t(
  "…nor drop it",
  denied(() => deleteDoc(setupDoc(bob, "cafe-a", "logo"))),
);
for (const status of ["provisioning", "failed", "disconnected", "suspended"]) {
  await seed(
    `cafes/cafe-a-${status}`,
    cafeRecord(ALICE, { site: `alice-${status}`, status }),
  );
  await t(
    `a ${status} cafe's logo is fixed`,
    denied(() => putLogo(alice, `cafe-a-${status}`)),
  );
}
await t(
  "…and so is dropping it",
  denied(() => deleteDoc(setupDoc(alice, "cafe-a-suspended", "logo"))),
);
await t(
  "an unverified owner cannot replace a live cafe's logo",
  denied(() => putLogo(lapsed, "cafe-l")),
);
await t(
  "not for a cafe that does not exist",
  denied(() => putLogo(alice, "cafe-nobody")),
);
await t(
  "owner B cannot give owner A's cafe a logo",
  denied(() => putLogo(bob, "cafe-a-draft")),
);
await t(
  "owner B cannot read owner A's menu",
  denied(() => getDoc(setupDoc(bob, "cafe-a-draft", "menu"))),
);
await t(
  "an unverified owner cannot give their draft a logo",
  denied(() => putLogo(lapsed, "cafe-l-draft")),
);
await t(
  "…but can read what is there, as they read the cafe",
  allowed(() => getDoc(setupDoc(lapsed, "cafe-l-draft", "menu"))),
);
for (const [who, c] of [
  ["signed out", nobody],
  ["anonymous", anon],
]) {
  await t(
    `${who}: cannot read a draft's menu`,
    denied(() => getDoc(setupDoc(c, "cafe-a-draft", "menu"))),
  );
}
await t(
  "an owner cannot list setup documents",
  denied(() => getDocs(collection(alice.db, "cafes", "cafe-a-draft", "setup"))),
);
await t(
  "the admin reads a draft's menu",
  allowed(() => getDoc(setupDoc(erin, "cafe-a-draft", "menu"))),
);
await t(
  "the admin cannot write one from a browser",
  denied(() => putMenu(erin, "cafe-a-draft")),
);

// -- releases ---------------------------------------------------------------------

console.log("\n releases");
await t(
  "a verified owner reads the releases",
  allowed(async () => {
    const snap = await getDocs(collection(alice.db, "releases"));
    expect(snap.size === 2, `expected 2 releases, got ${snap.size}`);
  }),
);
await t(
  "an unverified account cannot read the releases",
  denied(() => getDocs(collection(dave.db, "releases"))),
);
await t(
  "an owner cannot publish a release",
  denied(() =>
    setDoc(release(alice, "9.9.9"), {
      channel: "stable",
      notes: "",
      publishedAt: serverTimestamp(),
      schemaVersion: 1,
      withdrawn: false,
    }),
  ),
);
await t(
  "an owner cannot edit release notes",
  denied(() => updateDoc(release(alice, "1.1.0"), { notes: "Edited." })),
);
await t(
  "an owner cannot withdraw a release",
  denied(() => updateDoc(release(alice, "1.1.0"), { withdrawn: true })),
);
await t(
  "an owner cannot delete a release",
  denied(() => deleteDoc(release(alice, "1.0.0"))),
);

// -- deployments ------------------------------------------------------------------

console.log("\n deployments");
await t(
  "owner A reads a deployment of their cafe",
  allowed(() => getDoc(deploy(alice, "dep-a"))),
);
await t(
  "owner A cannot read owner B's deployment",
  denied(() => getDoc(deploy(alice, "dep-b"))),
);
await t(
  "owner A lists their cafe's deployments",
  allowed(async () => {
    const snap = await myDeployments(alice, "cafe-a");
    expect(snap.size === 1, `expected 1 deployment, got ${snap.size}`);
  }),
);
await t(
  "owner A cannot list every deployment",
  denied(() => getDocs(collection(alice.db, "deployments"))),
);
await t(
  "owner A cannot list owner B's cafe's deployments",
  denied(() =>
    getDocs(
      query(
        collection(alice.db, "deployments"),
        where("cafeId", "==", "cafe-b"),
      ),
    ),
  ),
);
await t(
  "owner A cannot mark a deploy done",
  denied(() =>
    updateDoc(deploy(alice, "dep-a"), {
      status: "succeeded",
      finishedAt: serverTimestamp(),
    }),
  ),
);
await t(
  "owner A cannot record a deployment of their own",
  denied(() =>
    setDoc(
      deploy(alice, "dep-forged"),
      deployment(alice, "cafe-a", {
        status: "succeeded",
        createdAt: serverTimestamp(),
      }),
    ),
  ),
);
await t(
  "owner A cannot delete a deployment",
  denied(() => deleteDoc(deploy(alice, "dep-a"))),
);
await t(
  "owner B cannot read owner A's deployment",
  denied(() => getDoc(deploy(bob, "dep-a"))),
);

// -- requests -------------------------------------------------------------------

console.log("\n requests (the console asks, the backend answers)");
const req = (c, id) => doc(c.db, "requests", id);
// Mirrors newRequestRecord() in src/lib/platform/records.ts: what the console
// writes. Only these keys; the backend adds the rest.
const newRequest = (c, o = {}) => ({
  cafeId: "cafe-a",
  ownerUid: c.uid,
  by: c.uid,
  kind: "check",
  params: { projectId: "alice-cafe" },
  status: "queued",
  createdAt: serverTimestamp(),
  ...o,
});
const ask = (c, id, o) => setDoc(req(c, id), newRequest(c, o));
const publish = {
  version: "1.2.0",
  channel: "stable",
  notes: "Fixes.",
  schemaVersion: 2,
};

await t(
  "owner A asks to check the connection of their cafe",
  allowed(() => ask(alice, "r-check")),
);
for (const [kind, params] of [
  ["provision", {}],
  ["deploy", { version: "1.1.0" }],
  ["deploy", { version: "1.2.0-beta.1" }],
  ["rollback", {}],
  ["sync-branding", {}],
]) {
  await t(
    `owner A asks for a ${kind} of their cafe`,
    allowed(() =>
      ask(alice, `r-${kind}-${params.version ?? 0}`, { kind, params }),
    ),
  );
}
await t(
  "…with an id Firestore chooses, as the console does",
  allowed(() => addDoc(collection(alice.db, "requests"), newRequest(alice))),
);
await t(
  "owner A cannot ask about owner B's cafe",
  denied(() => ask(alice, "r-theirs", { cafeId: "cafe-b" })),
);
await t(
  "…nor a cafe that doesn't exist",
  denied(() => ask(alice, "r-nothing", { cafeId: "no-such-cafe" })),
);
await t(
  "…nor in someone else's name",
  denied(() => ask(alice, "r-name", { by: BOB.uid })),
);
await t(
  "…nor with someone else as the owner of the request",
  denied(() => ask(alice, "r-owner", { ownerUid: BOB.uid })),
);
await t(
  "owner B cannot ask about owner A's cafe",
  denied(() => ask(bob, "r-b-for-a", { cafeId: "cafe-a" })),
);
await t(
  "an owner who has not verified their email cannot ask",
  denied(() =>
    ask(lapsed, "r-lapsed", {
      cafeId: "cafe-l",
      params: { projectId: "lapsed-cafe" },
    }),
  ),
);
await t(
  "someone who is not signed in cannot ask",
  denied(() => ask(nobody, "r-nobody", { ownerUid: ALICE.uid, by: ALICE.uid })),
);
await t(
  "an anonymous account cannot ask",
  denied(() => ask(anon, "r-anon", { ownerUid: ALICE.uid, by: ALICE.uid })),
);

await t(
  "an unknown kind is refused",
  denied(() => ask(alice, "r-kind", { kind: "format-disk", params: {} })),
);
await t(
  "an owner cannot ask for a release to be published",
  denied(() =>
    ask(alice, "r-publish", { kind: "publish", cafeId: null, params: publish }),
  ),
);
await t(
  "…nor rolled out",
  denied(() =>
    ask(alice, "r-rollout", {
      kind: "rollout",
      cafeId: null,
      params: { version: "1.2.0", action: "start" },
    }),
  ),
);
for (const [what, o] of [
  ["a check with no project", { params: {} }],
  [
    "a check with a project that isn't a project ID",
    { params: { projectId: "NOT a project" } },
  ],
  [
    "a check with something extra",
    { params: { projectId: "alice-cafe", force: true } },
  ],
  ["a deploy with no version", { kind: "deploy", params: {} }],
  ["a deploy of v1.1.0", { kind: "deploy", params: { version: "v1.1.0" } }],
  ["a deploy of 'latest'", { kind: "deploy", params: { version: "latest" } }],
  [
    "a rollback with params",
    { kind: "rollback", params: { version: "1.0.0" } },
  ],
  [
    "a setup with params",
    { kind: "provision", params: { projectId: "alice-cafe" } },
  ],
  [
    "a request with params that aren't a map",
    { kind: "rollback", params: "none" },
  ],
]) {
  await t(
    `${what} is refused`,
    denied(() => ask(alice, "r-params", o)),
  );
}
await t(
  "a request can't start out finished or running",
  denied(() => ask(alice, "r-status", { status: "done" })),
);
await t(
  "…nor carry a result, steps or an error of its own",
  denied(() =>
    ask(alice, "r-result", { result: { status: "connected" }, steps: [] }),
  ),
);
await t(
  "…nor a made-up time",
  denied(() => ask(alice, "r-time", { createdAt: Timestamp.fromDate(WHEN) })),
);
await t(
  "…nor leave out a field",
  denied(() => setDoc(req(alice, "r-short"), without(newRequest(alice), "by"))),
);

await t(
  "the admin asks for a release to be published",
  allowed(() =>
    ask(erin, "r-a-publish", {
      kind: "publish",
      cafeId: null,
      params: publish,
    }),
  ),
);
await t(
  "…and for a rollout to start or pause",
  allowed(async () => {
    for (const action of ["start", "pause"]) {
      await ask(erin, `r-a-${action}`, {
        kind: "rollout",
        cafeId: null,
        params: { version: "1.2.0", action },
      });
    }
  }),
);
await t(
  "…but not with a bad channel, or a made-up action",
  denied(async () => {
    await ask(erin, "r-a-channel", {
      kind: "publish",
      cafeId: null,
      params: { ...publish, channel: "nightly" },
    });
  }),
);
await t(
  "…nor a rollout with a made-up action",
  denied(() =>
    ask(erin, "r-a-action", {
      kind: "rollout",
      cafeId: null,
      params: { version: "1.2.0", action: "delete" },
    }),
  ),
);
await t(
  "…nor a release 'about' a cafe",
  denied(() =>
    ask(erin, "r-a-cafe", {
      kind: "publish",
      cafeId: "cafe-a",
      params: publish,
    }),
  ),
);
await t(
  "the admin cannot ask for a deploy of an owner's cafe from a browser",
  denied(() =>
    ask(erin, "r-a-deploy", { kind: "deploy", params: { version: "1.1.0" } }),
  ),
);
await t(
  "an admin claim on an unverified account asks for nothing",
  denied(() =>
    ask(frank, "r-f-publish", {
      kind: "publish",
      cafeId: null,
      params: publish,
    }),
  ),
);

// The backend answers on the same document: seeded here as the service
// account, which the rules don't hold to anything.
await seed("requests/r-answered", {
  ...newRequest(alice, { createdAt: WHEN, status: "done" }),
  steps: [{ id: "check", label: "Check", status: "done" }],
  result: { status: "connected" },
  error: null,
  attempts: 1,
  lease: null,
});
await t(
  "owner A reads their request and the backend's answer on it",
  allowed(async () => {
    const snap = await getDoc(req(alice, "r-answered"));
    expect(snap.data().result.status === "connected", "no answer");
  }),
);
await t(
  "owner A reads the progress of the request they just made",
  allowed(async () => {
    const snap = await getDoc(req(alice, "r-check"));
    expect(snap.data().status === "queued", "not queued");
  }),
);
await t(
  "owner B cannot read owner A's request",
  denied(() => getDoc(req(bob, "r-answered"))),
);
await t(
  "owner A lists their cafe's requests",
  allowed(async () => {
    const snap = await getDocs(
      query(
        collection(alice.db, "requests"),
        where("ownerUid", "==", alice.uid),
        where("cafeId", "==", "cafe-a"),
        orderBy("createdAt", "desc"),
        limit(10),
      ),
    );
    expect(snap.size >= 2, `expected their requests, got ${snap.size}`);
  }),
);
await t(
  "owner A cannot list every request",
  denied(() => getDocs(collection(alice.db, "requests"))),
);
await t(
  "…nor owner B's",
  denied(() =>
    getDocs(
      query(collection(alice.db, "requests"), where("ownerUid", "==", BOB.uid)),
    ),
  ),
);
await t(
  "the admin reads every request",
  allowed(async () => {
    const snap = await getDocs(collection(erin.db, "requests"));
    expect(snap.size >= 3, `expected them all, got ${snap.size}`);
  }),
);
await t(
  "an unverified account with the admin claim reads none",
  denied(() => getDocs(collection(frank.db, "requests"))),
);
for (const [who, c] of [
  ["owner A", alice],
  ["the admin", erin],
]) {
  await t(
    `${who} cannot mark a request done, or give it a result`,
    denied(() =>
      updateDoc(req(c, "r-check"), {
        status: "done",
        result: { status: "connected" },
      }),
    ),
  );
  await t(
    `${who} cannot change what was asked`,
    denied(() =>
      updateDoc(req(c, "r-check"), { params: { projectId: "bobs-cafe" } }),
    ),
  );
  await t(
    `${who} cannot delete a request`,
    denied(() => deleteDoc(req(c, "r-check"))),
  );
}
await t(
  "owner A cannot write over an answered request",
  denied(() => ask(alice, "r-answered")),
);

// -- the backend's deploy record ---------------------------------------------------

console.log("\n the deploy record (backend only)");
const record = (c) => doc(c.db, "cafes", "cafe-a", "private", "deployRecord");
await t(
  "owner A cannot read their cafe's deploy record",
  denied(() => getDoc(record(alice))),
);
await t(
  "owner A cannot write it",
  denied(() => setDoc(record(alice), { site: "cafe-a", schemaFloor: 1 })),
);
await t(
  "the admin cannot read it from a browser",
  denied(() => getDoc(record(erin))),
);

// -- the admin --------------------------------------------------------------------

console.log("\n the platform admin (custom claim)");
await t(
  "the admin reads any cafe",
  allowed(() => getDoc(cafe(erin, "cafe-b"))),
);
await t(
  "the admin lists every cafe",
  allowed(async () => {
    const snap = await allCafes(erin);
    expect(snap.size >= 4, `expected every cafe, got ${snap.size}`);
  }),
);
await t(
  "the admin lists every deployment",
  allowed(() => getDocs(collection(erin.db, "deployments"))),
);
await t(
  "the admin reads the releases",
  allowed(() => getDocs(collection(erin.db, "releases"))),
);
await t(
  "the admin cannot change release.current from a browser",
  denied(() => edit(erin, "cafe-a", { "release.current": "1.0.0" })),
);
await t(
  "the admin cannot change a cafe's status from a browser",
  denied(() => edit(erin, "cafe-b", { status: "suspended" })),
);
await t(
  "the admin cannot mark a deploy done from a browser",
  denied(() => updateDoc(deploy(erin, "dep-b"), { status: "succeeded" })),
);
await t(
  "the admin cannot publish a release from a browser",
  denied(() =>
    setDoc(release(erin, "9.9.9"), {
      channel: "stable",
      notes: "",
      publishedAt: serverTimestamp(),
      schemaVersion: 1,
      withdrawn: false,
    }),
  ),
);
// What the admin page (#30) asks for: the latest deployments of every cafe.
const latestDeployments = (c, n = 5) =>
  getDocs(
    query(
      collection(c.db, "deployments"),
      orderBy("createdAt", "desc"),
      limit(n),
    ),
  );
await t(
  "the admin lists the latest deployments of every cafe, newest first",
  allowed(async () => {
    const snap = await latestDeployments(erin);
    expect(
      snap.size >= 2,
      `expected both cafes' deployments, got ${snap.size}`,
    );
  }),
);
await t(
  "an owner cannot run that query: it is not theirs alone",
  denied(() => latestDeployments(alice)),
);
await t(
  "…nor can an unverified account with the claim",
  denied(() => latestDeployments(frank)),
);
await t(
  "the admin cannot start a deploy from a browser",
  denied(() =>
    setDoc(deploy(erin, "dep-from-admin"), {
      ...deployment(BOB, "cafe-b"),
      createdAt: serverTimestamp(),
    }),
  ),
);
await t(
  "the admin cannot withdraw a release from a browser",
  denied(() => updateDoc(release(erin, "1.1.0"), { withdrawn: true })),
);
await t(
  "the admin cannot edit an owner's settings",
  denied(() =>
    edit(erin, "cafe-b", { settings: settings({ name: "Taken over" }) }),
  ),
);
await t(
  "the admin cannot move a cafe to another owner",
  denied(() => edit(erin, "cafe-b", { ownerUid: ERIN.uid })),
);
// The admin sees the platform's records and nothing else: a cafe's orders
// are in the owner's own project, and no path here leads to them.
for (const path of ["orders", "staff", "rollouts"]) {
  await t(
    `the admin cannot read or write /${path}: nothing is kept there`,
    denied(() => getDocs(collection(erin.db, path))),
  );
}
await t(
  "…nor write a rollout from a browser",
  denied(() =>
    setDoc(doc(erin.db, "rollouts", "1.2.0-20261024"), { status: "paused" }),
  ),
);
await t(
  "an admin claim on an unverified account is not enough",
  denied(() => allCafes(frank)),
);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
await Promise.all(everyone.map((c) => deleteApp(c.a)));
process.exit(failures.length ? 1 : 0);

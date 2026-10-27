/**
 * Behavioural test for firestore.rules, run against the Firestore + Auth
 * emulators.
 *
 * Why this exists: the rules are the only thing standing between the public
 * internet and the cafe's order book, and they are not TypeScript, so nothing
 * else in this repo checks them. A syntax error in here once shipped unnoticed
 * and only surfaced at `firebase deploy`. This is the test that should have
 * existed from the start.
 *
 * Two deliberate choices:
 *
 * - It drives the real client SDK, not the REST API. The rules pin
 *   `createdAt == request.time` and only `serverTimestamp()` produces that; a
 *   REST-created document always carries a client-chosen timestamp, so REST
 *   cannot exercise that clause at all.
 *
 * - It signs real users in against the Auth emulator, because the difference
 *   between staff and owner is the whole point of the role helper. A second
 *   un-authenticated app would not be testing it.
 *
 *   npm run emulators            # terminal 1
 *   npm run test:rules           # terminal 2
 *
 * or in one command, which starts and stops the emulators itself:
 *
 *   firebase emulators:exec --only auth,firestore --project demo-cafe "npm run test:rules"
 *
 * The emulators need Java 21+. The project id defaults to demo-cafe
 * (FIRESTORE_EMULATOR_PROJECT overrides it); a demo- project cannot reach any
 * real Firebase project. CI runs this on every pull request.
 */
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  runTransaction,
  Timestamp,
} from "firebase/firestore";

const PROJECT = process.env.FIRESTORE_EMULATOR_PROJECT ?? "demo-cafe";
// `firebase emulators:exec` exports FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST as "host:port", so split them rather than
// gluing a second port onto the end.
const [fsEnvHost, fsEnvPort] = (
  process.env.FIRESTORE_EMULATOR_HOST ?? ""
).split(":");
const [, authEnvPort] = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "").split(
  ":",
);
const HOST = fsEnvHost || "127.0.0.1";
const FS_PORT = Number(
  process.env.FIRESTORE_EMULATOR_PORT || fsEnvPort || 8080,
);
const AUTH_PORT = Number(
  process.env.FIREBASE_AUTH_EMULATOR_PORT || authEnvPort || 9099,
);
const CFG = { projectId: PROJECT, apiKey: "demo", authDomain: "demo.local" };

const app = (name) => {
  const a = initializeApp(CFG, name);
  const auth = getAuth(a);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  const db = getFirestore(a);
  connectFirestoreEmulator(db, HOST, FS_PORT);
  return { a, auth, db };
};
const publicC = app("public");
// Never signs in at all: the caller issue #30 was about.
const nobodyC = app("nobody");
// A second anonymous caller stands in for "a different customer's phone": the
// rule must let each one read their own order and nothing else.
const otherCustomerC = app("other-customer");
// Handing out the owner role is destructive, so it gets its own throwaway
// account. Promoting the barista would quietly turn it into an owner and make
// every later run fail for a reason that has nothing to do with the rules.
const tempC = app("temp-user");
const staffC = app("staff");
const ownerC = app("owner");

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
// broken setup step (a failed sign-in, a typo'd path, a network blip) pass as
// "denied", and the suite would stay green while testing nothing.
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

// Create the two accounts, then give one of them the owner document that
// isOwner() looks for. The document is seeded over REST with the emulator's
// admin token, because an owner cannot be created by a non-owner.
const AUTH_BASE = `http://${HOST}:${AUTH_PORT}/identitytoolkit.googleapis.com/v1`;
// Idempotent: the emulators keep state between runs, so a second run hits
// EMAIL_EXISTS. Sign in instead. A test that only passes on a pristine emulator
// is a test that lies to you about whether it works.
const account = async (email) => {
  const creds = { email, password: "correct-horse", returnSecureToken: true };
  const post = (path) =>
    fetch(`${AUTH_BASE}/${path}?key=demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }).then((r) => r.json());
  const up = await post("accounts:signUp");
  if (up.localId) return up;
  const res = await post("accounts:signInWithPassword");
  if (!res.localId)
    throw new Error(`could not provision ${email}: ${JSON.stringify(res)}`);
  return res;
};

const ownerAcct = await account("owner@cafe.test");
const staffAcct = await account("staff@cafe.test");
await fetch(
  `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${ownerAcct.localId}`,
  {
    // PATCH, not POST: the emulator's REST layer rejects POST to a path with an
    // explicit document id ("parent name lacks /"), and a silently-missing role
    // document is indistinguishable from a broken isOwner().
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { role: { stringValue: "owner" } } }),
  },
).then(async (r) => {
  if (!r.ok)
    throw new Error(
      `could not seed the owner role: ${r.status} ${await r.text()}`,
    );
});
await signInWithEmailAndPassword(
  staffC.auth,
  "staff@cafe.test",
  "correct-horse",
);
await signInWithEmailAndPassword(
  ownerC.auth,
  "owner@cafe.test",
  "correct-horse",
);
publicC.user = (await signInAnonymously(publicC.auth)).user;
otherCustomerC.user = (await signInAnonymously(otherCustomerC.auth)).user;
// The emulators keep data between runs, so a previous run may have left the
// barista holding a role. Clear it so "barista" means barista every time.
await fetch(
  `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${staffAcct.localId}`,
  { method: "DELETE", headers: { Authorization: "Bearer owner" } },
);
const tempAcct = await account("temp@cafe.test");
await signInWithEmailAndPassword(tempC.auth, "temp@cafe.test", "correct-horse");

const line = (o = {}) => ({ name: "Espresso", qty: 2, price: 120, ...o });
// No orderNumber: the display number is derived from the document id on read,
// so the client has nothing to send (issue #30).
const order = (o = {}) => ({
  tableNumber: 3,
  items: [line()],
  total: 240,
  status: "preparing",
  createdAt: serverTimestamp(),
  notes: "",
  paymentMethod: "counter",
  ...o,
});
// Mirrors firestoreOrderRepo.create() in src/lib/data/firestore.ts: the order,
// pinned to the caller's anonymous uid, and the caller's throttle stamp, in one
// batch (issue #32). `stamp` overrides let a test forge the stamp.
const commitOrder = async (c, o = {}, stamp = {}) => {
  const uid = c.auth.currentUser.uid;
  const ref = doc(collection(c.db, "orders"));
  const batch = writeBatch(c.db);
  batch.set(ref, order({ customerUid: uid, ...o }));
  batch.set(doc(c.db, "orderThrottle", uid), {
    lastOrderAt: serverTimestamp(),
    lastOrderId: ref.id,
    ...stamp,
  });
  await batch.commit();
  return ref;
};
// A brand-new anonymous customer per order, so the 30-second throttle is never
// the reason a shape test passes or fails. signInAnonymously() hands back the
// existing anonymous user if there is one, hence the sign-out first. The
// throttle has its own section below, which keeps one uid on purpose.
const freshCustomer = async (c) => {
  await signOut(c.auth);
  return (await signInAnonymously(c.auth)).user;
};
const placeAs = async (c, o) => {
  await freshCustomer(c);
  return commitOrder(c, o);
};
// Plants a throttle stamp as if the customer's last order were `secondsAgo` in
// the past, over REST with the emulator's admin token. The alternative is a
// test that sleeps for half a minute on every run.
const seedStamp = async (uid, secondsAgo) => {
  const r = await fetch(
    `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/orderThrottle/${uid}`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          lastOrderAt: {
            timestampValue: new Date(
              Date.now() - secondsAgo * 1000,
            ).toISOString(),
          },
          lastOrderId: { stringValue: "seeded" },
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`could not seed a stamp: ${r.status}`);
};

// Table codes (tableKeys/{n}) are seeded and cleared over REST with the admin
// token, like the owner role above, so each run starts from the same place: the
// emulators keep data between runs, and a code left on table 3 by a previous
// run would make every ordinary order test below fail for the wrong reason.
const KEYED_TABLE = 41;
const TABLE_CODE = "Zq7RtW2mPx9L";
const adminDoc = (path, init = {}) =>
  fetch(
    `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    { ...init, headers: { Authorization: "Bearer owner", ...init.headers } },
  );
await adminDoc("tableKeys/3", { method: "DELETE" });
await adminDoc("tableKeys/42", { method: "DELETE" });
{
  const r = await adminDoc(`tableKeys/${KEYED_TABLE}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { key: { stringValue: TABLE_CODE } } }),
  });
  if (!r.ok) throw new Error(`could not seed a table code: ${r.status}`);
}
// Open tables (tableSessions/{n}). The ordinary order tests above and below
// place `preparing` orders on tables 3, 41 and 42, which the rules only take on
// an open table, so those are opened here (a month ahead, over REST, which the
// rules do not govern). Confirmation ("Approve new tables") is OFF by default;
// it is switched ON here, over REST, so those tests exercise the stricter
// case. The open-tables section at the end checks the default (no document)
// first, uses tables 10-14 and resets them itself.
const sessionField = (ms) => ({
  fields: { openUntil: { timestampValue: new Date(ms).toISOString() } },
});
const seedSession = async (table, ms) => {
  const r = await adminDoc(`tableSessions/${table}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionField(ms)),
  });
  if (!r.ok) throw new Error(`could not seed a table session: ${r.status}`);
};
const seedOrdering = async (fields) => {
  const r = await adminDoc("config/ordering", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`could not seed config/ordering: ${r.status}`);
};
await seedOrdering({ confirmNewGuests: { booleanValue: true } });
for (const table of [3, 41, 42])
  await seedSession(table, Date.now() + 30 * 24 * 3600_000);
for (const table of [10, 11, 13, 14])
  await adminDoc(`tableSessions/${table}`, { method: "DELETE" });
await seedSession(12, Date.now() - 60_000);

// An order for the coded table. `tableKey: undefined` means "leave it off",
// which is what a phone that arrived without a code sends.
const keyed = (o = {}) => {
  const out = { tableNumber: KEYED_TABLE, tableKey: TABLE_CODE, ...o };
  if (out.tableKey === undefined) delete out.tableKey;
  return out;
};

console.log(`\nfirestore.rules vs the emulators (${PROJECT})\n`);
console.log(" anonymous customer (an anonymous uid, not an account)");
await t(
  "can place a valid order",
  allowed(() => placeAs(publicC)),
);
await t(
  "cannot set status=completed",
  denied(() => placeAs(publicC, { status: "completed" })),
);
await t(
  "cannot send total as a string",
  denied(() => placeAs(publicC, { total: "240" })),
);
await t(
  "cannot send a negative total",
  denied(() => placeAs(publicC, { total: -500 })),
);
await t(
  "cannot inject an extra field",
  denied(() => placeAs(publicC, { completedAt: serverTimestamp() })),
);
await t(
  "cannot send an empty basket",
  denied(() => placeAs(publicC, { items: [] })),
);
await t(
  "cannot send 51 line items",
  denied(() => placeAs(publicC, { items: Array(51).fill(line()) })),
);
await t(
  "cannot use tableNumber 0",
  denied(() => placeAs(publicC, { tableNumber: 0 })),
);
await t(
  "cannot invent a payment method",
  denied(() => placeAs(publicC, { paymentMethod: "wire" })),
);
await t(
  "cannot backdate createdAt",
  denied(() => placeAs(publicC, { createdAt: new Date(2020, 0, 1) })),
);
await t(
  "cannot set qty 0 on a line",
  denied(() => placeAs(publicC, { items: [line({ qty: 0 })] })),
);
await t(
  "cannot set an absurd unit price",
  denied(() => placeAs(publicC, { items: [line({ price: 999999 })] })),
);
// `get` and `list` are separate rules, and the difference is not academic: a
// single `allow read: if isStaff() || resource.data.customerUid == ...` leaves
// Firestore unable to prove a list query is safe, and the staff board fails with
// "Missing or insufficient permissions" while single reads carry on working.
await t(
  "a customer can get their own order by id",
  allowed(async () => {
    const mine = await placeAs(publicC, { notes: "get me" });
    const snap = await getDoc(doc(publicC.db, "orders", mine.id));
    if (!snap.exists()) throw new Error("could not read its own order");
  }),
);
await t(
  "a customer cannot get somebody else's order by id",
  denied(async () => {
    const other = await placeAs(otherCustomerC, { notes: "not yours" });
    const snap = await getDoc(doc(publicC.db, "orders", other.id));
    if (snap.exists()) throw new Error("read a stranger's order");
  }),
);
await t(
  "cannot list a board at all",
  denied(() => getDocs(collection(publicC.db, "orders"))),
);
await t(
  "cannot list a board containing another customer's order",
  denied(() => getDocs(collection(publicC.db, "orders"))),
);
await t(
  "cannot rewrite a placed order",
  denied(async () => {
    // Its own order, so the refusal is about rewriting, not about ownership.
    const mine = await placeAs(publicC);
    await setDoc(
      doc(publicC.db, "orders", mine.id),
      { total: 1 },
      { merge: true },
    );
  }),
);
await t(
  "cannot write the menu",
  denied(() =>
    addDoc(collection(publicC.db, "menu"), { name: "Hack", price: 0 }),
  ),
);
await t(
  "cannot grant themselves owner",
  denied(() => setDoc(doc(publicC.db, "staff", "me"), { role: "owner" })),
);
await t(
  "cannot write an unknown collection",
  denied(() => addDoc(collection(publicC.db, "secrets"), { a: 1 })),
);
// Issue #30: /meta/counters used to be writable by anyone. The display number is
// derived from the order id now, so nothing needs it and nobody may write it.
await t(
  "cannot send an orderNumber on an order",
  denied(() => placeAs(publicC, { orderNumber: 101 })),
);
await t(
  "cannot write meta/counters (the old order counter)",
  denied(() =>
    setDoc(doc(publicC.db, "meta", "counters"), { orderNumber: 999999 }),
  ),
);
await t(
  "cannot reset meta/counters with a merge",
  denied(() =>
    setDoc(
      doc(publicC.db, "meta", "counters"),
      { orderNumber: 0 },
      { merge: true },
    ),
  ),
);
await t(
  "cannot write any other /meta document",
  denied(() => setDoc(doc(publicC.db, "meta", "anything"), { a: 1 })),
);

// The per-table secret code in the QR card (src/lib/table-keys.ts).
console.log("\n table codes, from the customer's side");
await t(
  "a table with a code takes an order carrying that code",
  allowed(() => placeAs(publicC, keyed())),
);
await t(
  "a table with a code refuses an order with no code (a typed-in address)",
  denied(() => placeAs(publicC, keyed({ tableKey: undefined }))),
);
await t(
  "a table with a code refuses the wrong code (an old card)",
  denied(() => placeAs(publicC, keyed({ tableKey: "OldCardCode1" }))),
);
await t(
  "a table with a code refuses an empty code",
  denied(() => placeAs(publicC, keyed({ tableKey: "" }))),
);
await t(
  "a table with no code yet still takes a keyless order (the transition)",
  allowed(() => placeAs(publicC, { tableNumber: 3 })),
);
await t(
  "a table with no code ignores a leftover code from an old scan",
  allowed(() => placeAs(publicC, { tableNumber: 3, tableKey: "Leftover1234" })),
);
await t(
  "the code must be a string",
  denied(() => placeAs(publicC, { tableNumber: 3, tableKey: 12345678901 })),
);
await t(
  "the code cannot be longer than 64 characters",
  denied(() => placeAs(publicC, { tableNumber: 3, tableKey: "a".repeat(65) })),
);
await t(
  "a customer cannot read a table's code",
  denied(() => getDoc(doc(publicC.db, "tableKeys", String(KEYED_TABLE)))),
);
await t(
  "a customer cannot list the codes",
  denied(() => getDocs(collection(publicC.db, "tableKeys"))),
);
await t(
  "a customer cannot overwrite a table's code",
  denied(() =>
    setDoc(doc(publicC.db, "tableKeys", String(KEYED_TABLE)), {
      key: "MyOwnCode123",
    }),
  ),
);
await t(
  "a customer cannot give a table with no code a code of their choosing",
  denied(() =>
    setDoc(doc(publicC.db, "tableKeys", "3"), { key: "Chosen12345" }),
  ),
);
await t(
  "a customer cannot delete a table's code to reopen it",
  denied(() => deleteDoc(doc(publicC.db, "tableKeys", String(KEYED_TABLE)))),
);

console.log("\n order size caps");
const lines = (n, o = {}) => Array.from({ length: n }, () => line(o));
await t(
  "20 lines is allowed",
  allowed(() =>
    placeAs(publicC, { items: lines(20, { qty: 1 }), total: 2400 }),
  ),
);
await t(
  "21 lines is refused",
  denied(() => placeAs(publicC, { items: lines(21, { qty: 1 }), total: 2520 })),
);
await t(
  "20 of one item is allowed",
  allowed(() => placeAs(publicC, { items: [line({ qty: 20 })], total: 2400 })),
);
await t(
  "21 of one item is refused",
  denied(() => placeAs(publicC, { items: [line({ qty: 21 })], total: 2520 })),
);
await t(
  "21 of the last item is refused too",
  denied(() =>
    placeAs(publicC, {
      items: [line({ qty: 1 }), line({ qty: 21 })],
      total: 2640,
    }),
  ),
);
await t(
  "0 of the last item is refused",
  denied(() =>
    placeAs(publicC, {
      items: [line({ qty: 1 }), line({ qty: 0 })],
      total: 120,
    }),
  ),
);
// No config/site yet (a rerun may have left one): TOE's cap of 10,000 whole
// rupees. The per-currency caps are further down, once it is seeded.
await adminDoc("config/site", { method: "DELETE" });
await t(
  "a ₹10,000 order is allowed",
  allowed(() =>
    placeAs(publicC, { items: [line({ qty: 10, price: 1000 })], total: 10000 }),
  ),
);
await t(
  "a ₹10,001 order is refused",
  denied(() => placeAs(publicC, { total: 10001 })),
);

console.log("\n signed-out caller (no auth at all)");
await t(
  "cannot write meta/counters",
  denied(() =>
    setDoc(doc(nobodyC.db, "meta", "counters"), { orderNumber: 999999 }),
  ),
);
await t(
  "cannot read meta/counters",
  denied(() => getDoc(doc(nobodyC.db, "meta", "counters"))),
);
await t(
  "cannot place an order without an anonymous uid",
  denied(() =>
    addDoc(collection(nobodyC.db, "orders"), order({ customerUid: "x" })),
  ),
);

// Issue #32: one order per anonymous uid per 30 seconds. Unlike placeAs(), these
// deliberately keep ONE customer across tests, because the clock is the subject.
console.log("\n order throttle (one customer, one uid)");
const throttleC = app("throttle");
const loner = app("throttle-forger");
const throttleUid = (await freshCustomer(throttleC)).uid;
await t(
  "a first order from a new customer goes through",
  allowed(() => commitOrder(throttleC)),
);
await t(
  "a second order seconds later is refused",
  denied(() => commitOrder(throttleC)),
);
await t(
  "a customer can read their own throttle stamp",
  allowed(async () => {
    const snap = await getDoc(doc(throttleC.db, "orderThrottle", throttleUid));
    if (!snap.exists()) throw new Error("the stamp was not written");
  }),
);
await t(
  "cannot delete their own stamp to reset the clock",
  denied(() => deleteDoc(doc(throttleC.db, "orderThrottle", throttleUid))),
);
await t(
  "still refused 25 seconds after the last order",
  denied(async () => {
    await seedStamp(throttleUid, 25);
    await commitOrder(throttleC);
  }),
);
await t(
  "allowed again once 31 seconds have passed",
  allowed(async () => {
    await seedStamp(throttleUid, 31);
    await commitOrder(throttleC);
  }),
);
await t(
  "and refused again straight after that one",
  denied(() => commitOrder(throttleC)),
);
if (process.env.RULES_TEST_REAL_WAIT) {
  // The seeded tests above trust the emulator's clock arithmetic. This one
  // actually waits, for anyone who does not.
  console.log("        (waiting 31 s of real time...)");
  await new Promise((r) => setTimeout(r, 31_000));
  await t(
    "allowed after a real 31-second wait",
    allowed(() => commitOrder(throttleC)),
  );
}
await t(
  "an order with no throttle stamp is refused",
  denied(async () => {
    const { uid } = await freshCustomer(loner);
    await addDoc(collection(loner.db, "orders"), order({ customerUid: uid }));
  }),
);
await t(
  "a stamp naming a different order is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderId: "some-other-order" });
  }),
);
await t(
  "a backdated stamp is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderAt: new Date(2020, 0, 1) });
  }),
);
await t(
  "a stamp with an extra field is refused",
  denied(async () => {
    await freshCustomer(loner);
    await commitOrder(loner, {}, { lastOrderAt: serverTimestamp(), n: 1 });
  }),
);
await t(
  "one stamp cannot carry two orders in one batch",
  denied(async () => {
    const { uid } = await freshCustomer(loner);
    const a = doc(collection(loner.db, "orders"));
    const b = doc(collection(loner.db, "orders"));
    const batch = writeBatch(loner.db);
    batch.set(a, order({ customerUid: uid }));
    batch.set(b, order({ customerUid: uid }));
    batch.set(doc(loner.db, "orderThrottle", uid), {
      lastOrderAt: serverTimestamp(),
      lastOrderId: a.id,
    });
    await batch.commit();
  }),
);
await t(
  "cannot stamp another customer's throttle document",
  denied(async () => {
    await freshCustomer(loner);
    await setDoc(doc(loner.db, "orderThrottle", throttleUid), {
      lastOrderAt: serverTimestamp(),
      lastOrderId: "x",
    });
  }),
);
await t(
  "cannot read another customer's throttle stamp",
  denied(() => getDoc(doc(loner.db, "orderThrottle", throttleUid))),
);
await t(
  "a different customer is not held up by someone else's order",
  allowed(async () => {
    await freshCustomer(loner);
    await commitOrder(loner);
  }),
);

console.log("\n signed-in barista (no role document)");
// Each status assertion places its own order and then drives that document, so
// the result cannot depend on whatever state an earlier test left behind or on
// which document a query happens to return first.
const drive = (c) => async (o) => {
  const id = (await placeAs(publicC)).id;
  return setDoc(doc(c.db, "orders", id), o, { merge: true });
};
// Steps ONE order through the machine. drive() places a fresh order per call, so
// walking a chain with it would try to jump "preparing" straight to "served" on
// three different documents and fail for the right reason for the wrong reason.
const chain = (c) => {
  let id = null;
  return async (status) => {
    id ??= (await placeAs(publicC)).id;
    return setDoc(doc(c.db, "orders", id), { status }, { merge: true });
  };
};
await t(
  "an account with no role document is not staff",
  denied(() => getDocs(collection(staffC.db, "orders"))),
);
await t(
  "given a role document, the same account becomes staff",
  allowed(async () => {
    await fetch(
      `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${staffAcct.localId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { role: { stringValue: "staff" } } }),
      },
    );
    await getDocs(collection(staffC.db, "orders"));
  }),
);
await t(
  "a staff account can read the order board",
  allowed(() => getDocs(collection(staffC.db, "orders"))),
);
await t(
  "can advance preparing -> ready",
  allowed(() => drive(staffC)({ status: "ready" })),
);
await t(
  "can advance ready -> served",
  allowed(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
  }),
);
await t(
  "can advance served -> completed",
  allowed(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("completed");
  }),
);
await t(
  "cannot skip a state (preparing -> served)",
  denied(() => drive(staffC)({ status: "served" })),
);
await t(
  "cannot move an order backwards (served -> ready)",
  denied(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("ready");
  }),
);
await t(
  "cannot un-complete a finished order",
  denied(async () => {
    const step = chain(staffC);
    await step("ready");
    await step("served");
    await step("completed");
    await step("served");
  }),
);
// Rejecting (issue: prank orders). preparing/ready -> rejected, with an
// optional short reason; nothing leaves rejected.
const reject =
  (c, from, patch = {}) =>
  async () => {
    const ref = await placeAs(publicC);
    const path = doc(staffC.db, "orders", ref.id);
    for (const s of from) await setDoc(path, { status: s }, { merge: true });
    await setDoc(
      doc(c.db, "orders", ref.id),
      { status: "rejected", ...patch },
      { merge: true },
    );
    return ref;
  };
await t("can reject a preparing order", allowed(reject(staffC, [])));
await t(
  "can reject a ready order, with a reason",
  allowed(reject(staffC, ["ready"], { rejectReason: "No one at this table" })),
);
await t(
  "can reject with an 80-character reason",
  allowed(reject(staffC, [], { rejectReason: "x".repeat(80) })),
);
await t(
  "cannot reject with an 81-character reason",
  denied(reject(staffC, [], { rejectReason: "x".repeat(81) })),
);
await t(
  "cannot reject with a reason that is not text",
  denied(reject(staffC, [], { rejectReason: 42 })),
);
await t(
  "cannot reject an order that has been served",
  denied(reject(staffC, ["ready", "served"])),
);
await t(
  "cannot reject a completed order",
  denied(reject(staffC, ["ready", "served", "completed"])),
);
await t(
  "cannot slip another field in with a reject",
  denied(reject(staffC, [], { total: 1 })),
);
await t(
  "cannot stamp completedAt on a reject",
  denied(reject(staffC, [], { completedAt: serverTimestamp() })),
);
await t(
  "cannot add a reject reason to an ordinary status change",
  denied(() => drive(staffC)({ status: "ready", rejectReason: "x" })),
);
await t(
  "rejected is terminal: cannot move it back to preparing",
  denied(async () => {
    const ref = await reject(staffC, [])();
    await setDoc(
      doc(staffC.db, "orders", ref.id),
      { status: "preparing" },
      { merge: true },
    );
  }),
);
await t(
  "rejected is terminal: cannot complete it",
  denied(async () => {
    const ref = await reject(staffC, [])();
    await setDoc(
      doc(staffC.db, "orders", ref.id),
      { status: "completed", completedAt: serverTimestamp() },
      { merge: true },
    );
  }),
);
await t(
  "a customer cannot reject their own order",
  denied(async () => {
    const ref = await placeAs(publicC);
    await setDoc(
      doc(publicC.db, "orders", ref.id),
      { status: "rejected" },
      { merge: true },
    );
  }),
);
await t(
  "a customer cannot un-reject their own order",
  denied(async () => {
    const ref = await reject(staffC, [])();
    await setDoc(
      doc(publicC.db, "orders", ref.id),
      { status: "preparing" },
      { merge: true },
    );
  }),
);
await t(
  "a barista cannot read a table's code",
  denied(() => getDoc(doc(staffC.db, "tableKeys", String(KEYED_TABLE)))),
);
await t(
  "a barista cannot list the codes",
  denied(() => getDocs(collection(staffC.db, "tableKeys"))),
);
await t(
  "a barista cannot change a table's code",
  denied(() =>
    setDoc(doc(staffC.db, "tableKeys", String(KEYED_TABLE)), {
      key: "BaristaCode12",
    }),
  ),
);
await t(
  "cannot write meta/counters either",
  denied(() => setDoc(doc(staffC.db, "meta", "counters"), { orderNumber: 1 })),
);
await t(
  "cannot edit the menu (barista != owner)",
  denied(() =>
    addDoc(collection(staffC.db, "menu"), { name: "Hack", price: 0 }),
  ),
);
await t(
  "cannot add fields to a live order",
  denied(() => drive(staffC)({ gone: 1 })),
);
await t(
  "cannot edit the price on a live order",
  denied(() => drive(staffC)({ total: 1 })),
);
await t(
  "a barista cannot promote themselves to owner",
  denied(() =>
    setDoc(doc(staffC.db, "staff", staffAcct.localId), { role: "owner" }),
  ),
);

console.log("\n signed-in owner");
await t(
  "can write the menu",
  allowed(() =>
    addDoc(collection(ownerC.db, "menu"), { name: "Cortado", price: 150 }),
  ),
);
await t(
  "can read every staff record",
  allowed(() => getDocs(collection(ownerC.db, "staff"))),
);
await t(
  "can hand out the owner role",
  allowed(() =>
    setDoc(doc(ownerC.db, "staff", tempAcct.localId), { role: "owner" }),
  ),
);
await t(
  "a promoted user can then edit the menu",
  allowed(async () => {
    await signInWithEmailAndPassword(
      tempC.auth,
      "temp@cafe.test",
      "correct-horse",
    );
    await addDoc(collection(tempC.db, "menu"), { name: "Cortado", price: 150 });
  }),
);
await t(
  "a barista cannot promote themselves",
  denied(() =>
    setDoc(doc(staffC.db, "staff", staffAcct.localId), { role: "owner" }),
  ),
);

// The owner's table list (/admin/qr). Runs last so the barista already holds
// its staff role document: a staff account, not a stranger, is the refusal
// that matters here.
console.log("\n config/tables (the owner's table list)");
const tablesDoc = (c) => doc(c.db, "config", "tables");
await t(
  "the owner can save a table list",
  allowed(() =>
    setDoc(tablesDoc(ownerC), { tables: [1, 2, 3, 4, 5, 6, 7, 8] }),
  ),
);
await t(
  "the owner can save a list with gaps",
  allowed(() => setDoc(tablesDoc(ownerC), { tables: [1, 2, 3, 12, 14, 50] })),
);
await t(
  "anyone, signed out, can read it",
  allowed(() => getDoc(tablesDoc(nobodyC))),
);
await t(
  "a customer can read it",
  allowed(() => getDoc(tablesDoc(publicC))),
);
await t(
  "a barista cannot change it",
  denied(() => setDoc(tablesDoc(staffC), { tables: [1, 2] })),
);
await t(
  "a customer cannot change it",
  denied(() => setDoc(tablesDoc(publicC), { tables: [1, 2] })),
);
await t(
  "a signed-out caller cannot change it",
  denied(() => setDoc(tablesDoc(nobodyC), { tables: [1, 2] })),
);
await t(
  "a barista cannot delete it",
  denied(() => deleteDoc(tablesDoc(staffC))),
);
await t(
  "the owner cannot save an empty list",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [] })),
);
await t(
  "the owner cannot save something that is not a list",
  denied(() => setDoc(tablesDoc(ownerC), { tables: "1,2,3" })),
);
await t(
  "the owner cannot save more than 50 tables",
  denied(() => setDoc(tablesDoc(ownerC), { tables: Array(51).fill(1) })),
);
await t(
  "the owner cannot save table 0",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [0, 1, 2] })),
);
await t(
  "the owner cannot save a table above 50",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1, 2, 51] })),
);
await t(
  "the owner cannot save a fractional table",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1.5, 2] })),
);
await t(
  "the owner cannot save text for a table",
  denied(() => setDoc(tablesDoc(ownerC), { tables: ["1", 2] })),
);
await t(
  "the owner cannot add other fields",
  denied(() => setDoc(tablesDoc(ownerC), { tables: [1, 2], note: "x" })),
);
await t(
  "the owner cannot slip a field in with a merge",
  denied(() => setDoc(tablesDoc(ownerC), { note: "x" }, { merge: true })),
);
await t(
  "the owner can delete it, back to the default",
  allowed(() => deleteDoc(tablesDoc(ownerC))),
);
// The carve-out on /config/{docId} must not have cost the owner the special.
await t(
  "the owner can still save today's special",
  allowed(() =>
    setDoc(doc(ownerC.db, "config", "special"), { enabled: true, text: "Hi" }),
  ),
);
await t(
  "a barista still cannot save today's special",
  denied(() =>
    setDoc(doc(staffC.db, "config", "special"), { enabled: true, text: "x" }),
  ),
);

// The cafe's settings (packages/shared CafeSettings). Everyone reads them;
// nobody but the platform's service account writes them, and server
// credentials bypass the rules, so every client write here must be refused,
// the owner's included. Seeded over REST with the emulator's admin token,
// which stands in for the platform.
console.log("\n config/site (the cafe's settings)");
// With CAFE_FIXTURE=toe (CI does this), the settings seeded are that fixture
// cafe's own, from fixtures/ (issue #18).
const FIXTURE = process.env.CAFE_FIXTURE?.trim();
const readFixture = async (name) => {
  const { readFile } = await import("node:fs/promises");
  const file = new URL(`../fixtures/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8"));
};
const SITE_SETTINGS = FIXTURE
  ? await readFixture(FIXTURE)
  : {
      schemaVersion: 1,
      name: "Rules Test Cafe",
      tagline: "Checked on every pull request",
      theme: "cozy",
      accent: null,
      logo: null,
      currency: "INR",
      locale: "en-IN",
      timeZone: "Asia/Kolkata",
      utcOffsets: { standard: 330, daylight: 330 },
      tables: [1, 2, 3, 4, 5, 6],
      baseUrl: null,
      plan: "free",
    };
if (FIXTURE) console.log(`  (seeded as fixtures/${FIXTURE}.json)`);
// Plain JSON to the REST API's typed values.
const restValue = (v) => {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(restValue) } };
  return { mapValue: { fields: restFields(v) } };
};
const restFields = (o) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, restValue(v)]));
{
  const r = await adminDoc("config/site", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: restFields(SITE_SETTINGS) }),
  });
  if (!r.ok) throw new Error(`could not seed config/site: ${r.status}`);
}
const siteDoc = (c) => doc(c.db, "config", "site");
await t(
  "anyone, signed out, can read the cafe's settings",
  allowed(async () => {
    const snap = await getDoc(siteDoc(nobodyC));
    if (snap.data()?.name !== SITE_SETTINGS.name)
      throw new Error("read something other than the seeded settings");
  }),
);
await t(
  "a customer can read them",
  allowed(() => getDoc(siteDoc(publicC))),
);
await t(
  "a barista can read them",
  allowed(() => getDoc(siteDoc(staffC))),
);
await t(
  "the owner can read them",
  allowed(() => getDoc(siteDoc(ownerC))),
);
await t(
  "the owner cannot replace them, even with valid settings",
  denied(() => setDoc(siteDoc(ownerC), { ...SITE_SETTINGS, name: "Renamed" })),
);
await t(
  "the owner cannot change one field with a merge",
  denied(() =>
    setDoc(siteDoc(ownerC), { timeZone: "Europe/London" }, { merge: true }),
  ),
);
await t(
  "the owner cannot move the offsets the order-number rules use",
  denied(() =>
    setDoc(
      siteDoc(ownerC),
      { utcOffsets: { standard: 0, daylight: 0 } },
      { merge: true },
    ),
  ),
);
await t(
  "the owner cannot delete them",
  denied(() => deleteDoc(siteDoc(ownerC))),
);
await t(
  "a barista cannot write them",
  denied(() => setDoc(siteDoc(staffC), SITE_SETTINGS)),
);
await t(
  "a customer cannot write them",
  denied(() => setDoc(siteDoc(publicC), SITE_SETTINGS)),
);
await t(
  "a signed-out caller cannot write them",
  denied(() => setDoc(siteDoc(nobodyC), SITE_SETTINGS)),
);
await t(
  "a signed-out caller cannot delete them",
  denied(() => deleteDoc(siteDoc(nobodyC))),
);
// The carve-out must not have cost the owner the rest of config.
await t(
  "the owner can still save today's special after the settings carve-out",
  allowed(() =>
    setDoc(doc(ownerC.db, "config", "special"), { enabled: false, text: "" }),
  ),
);

console.log("\n tableKeys (the owner's QR codes)");
const keyDoc = (c, n) => doc(c.db, "tableKeys", String(n));
await t(
  "the owner can read a table's code",
  allowed(async () => {
    const snap = await getDoc(keyDoc(ownerC, KEYED_TABLE));
    if (snap.data()?.key !== TABLE_CODE)
      throw new Error("wrong code read back");
  }),
);
await t(
  "the owner can list every code",
  allowed(() => getDocs(collection(ownerC.db, "tableKeys"))),
);
await t(
  "the owner can create a code",
  allowed(() => setDoc(keyDoc(ownerC, 42), { key: "FreshCode4242" })),
);
await t(
  "the owner can renew a code",
  allowed(() => setDoc(keyDoc(ownerC, 42), { key: "RenewedCode42" })),
);
await t(
  "and the renewed code is the one orders need",
  allowed(async () => {
    await placeAs(publicC, { tableNumber: 42, tableKey: "RenewedCode42" });
  }),
);
await t(
  "while the old code is refused",
  denied(() =>
    placeAs(publicC, { tableNumber: 42, tableKey: "FreshCode4242" }),
  ),
);
await t(
  "the owner cannot save a code shorter than 10 characters",
  denied(() => setDoc(keyDoc(ownerC, 42), { key: "short" })),
);
await t(
  "the owner cannot save a code that is not text",
  denied(() => setDoc(keyDoc(ownerC, 42), { key: 1234567890123 })),
);
await t(
  "the owner cannot add other fields",
  denied(() => setDoc(keyDoc(ownerC, 42), { key: "FreshCode4242", n: 1 })),
);
await t(
  "the owner cannot file a code under something that is not a table",
  denied(() =>
    setDoc(doc(ownerC.db, "tableKeys", "abc"), { key: "Code123456" }),
  ),
);
await t(
  "the owner cannot file a code for a table above 50",
  denied(() =>
    setDoc(doc(ownerC.db, "tableKeys", "51"), { key: "Code123456" }),
  ),
);
await t(
  "the owner cannot save a code a QR link could not carry",
  denied(() => setDoc(keyDoc(ownerC, 42), { key: "Fresh Code 42" })),
);
await t(
  "the owner can delete a code, reopening the table",
  allowed(async () => {
    await deleteDoc(keyDoc(ownerC, 42));
    await placeAs(publicC, { tableNumber: 42 });
  }),
);

// Today's order numbers (#0001…): the staff board writes dayNumber/dayKey on an
// order and bumps dayCounters/{YYYY-MM-DD} in the same commit. The emulators
// keep data between runs, so every test here works on days of its own: orders
// are seeded over REST with a createdAt on a date no earlier run used, which
// is also the only way to place an order on a day other than today.
console.log("\n daily order numbers (dayCounters)");
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;
const istKey = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
// A fresh IST day per call, three days apart (so a test that also uses "the
// next day" never lands on another test's day): counts back from 1999 by the run's clock, so two
// runs (and two calls in one run) never share a day or its counter.
let dayCursor = Math.floor(Date.now() / 1000) % 20_000;
const freshDay = () => {
  dayCursor += 3;
  // 06:00 UTC = 11:30 IST, safely inside the day.
  return Date.UTC(1999, 0, 1) - dayCursor * DAY_MS + 6 * 3_600_000;
};
let seededOrders = 0;
const seedOrderAt = async (createdAtMs, status = "preparing") => {
  seededOrders += 1;
  const id = `daynum-${Date.now().toString(36)}-${seededOrders}`;
  const r = await adminDoc(`orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        tableNumber: { integerValue: "3" },
        items: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    name: { stringValue: "Espresso" },
                    qty: { integerValue: "1" },
                    price: { integerValue: "120" },
                  },
                },
              },
            ],
          },
        },
        total: { integerValue: "120" },
        status: { stringValue: status },
        createdAt: { timestampValue: new Date(createdAtMs).toISOString() },
        notes: { stringValue: "" },
        paymentMethod: { stringValue: "counter" },
        customerUid: { stringValue: "seeded" },
      },
    }),
  });
  if (!r.ok) throw new Error(`could not seed an order: ${r.status}`);
  return id;
};
const seedCounter = async (key, next) => {
  const r = await adminDoc(`dayCounters/${key}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { next: { integerValue: String(next) } } }),
  });
  if (!r.ok) throw new Error(`could not seed a counter: ${r.status}`);
};
const counterDoc = (c, key) => doc(c.db, "dayCounters", key);
// What the board does, as a plain batch: the rules see a batch and a
// transaction's commit the same way. `next` overrides the counter value,
// `last` the order the counter names, `counter: false` leaves it alone.
const numberOrder = (
  c,
  id,
  key,
  n,
  { next = n + 1, last = id, counter = true, extra } = {},
) => {
  const batch = writeBatch(c.db);
  batch.update(doc(c.db, "orders", id), {
    dayNumber: n,
    dayKey: key,
    ...extra,
  });
  if (counter) batch.set(counterDoc(c, key), { next, last });
  return batch.commit();
};
// The attack the counter's `last` exists for: one commit numbering two orders
// with the same number against a single bump.
const numberTwo = (c, ids, key, n, last = ids[0]) => {
  const batch = writeBatch(c.db);
  for (const id of ids)
    batch.update(doc(c.db, "orders", id), { dayNumber: n, dayKey: key });
  batch.set(counterDoc(c, key), { next: n + 1, last });
  return batch.commit();
};
// The board's transaction (src/lib/day-number.ts + firestore.ts), in plain JS,
// including its one subtlety: the board that loses a race can be told
// permission-denied rather than being retried (the emulator evaluates the rules
// against the winner's commit), so on a refusal it re-reads the order, and if
// somebody else has numbered it, that is a lost race, not an error.
const assignTx = async (c, id) => {
  try {
    return await assignTxOnce(c, id);
  } catch (e) {
    if (e?.code !== "permission-denied") throw e;
    const now = await getDoc(doc(c.db, "orders", id));
    if (now.data()?.dayNumber !== undefined) return null;
    throw e;
  }
};
const assignTxOnce = (c, id) =>
  runTransaction(c.db, async (tx) => {
    const orderRef = doc(c.db, "orders", id);
    const o = await tx.get(orderRef);
    if (!o.exists() || o.data().dayNumber !== undefined) return null;
    const key = istKey(o.data().createdAt.toMillis());
    const cRef = counterDoc(c, key);
    const counter = await tx.get(cRef);
    const n = counter.exists() ? counter.data().next : 1;
    tx.update(orderRef, { dayNumber: n, dayKey: key });
    tx.set(cRef, { next: n + 1, last: id });
    return n;
  });

{
  const day = freshDay();
  const key = istKey(day);
  const a = await seedOrderAt(day);
  const b = await seedOrderAt(day + 60_000);
  const c = await seedOrderAt(day + 120_000);
  const d = await seedOrderAt(day + 180_000);
  const e = await seedOrderAt(day + 240_000);

  await t(
    "a customer cannot read a day's counter",
    denied(() => getDoc(counterDoc(publicC, key))),
  );
  await t(
    "a customer cannot list the counters",
    denied(() => getDocs(collection(publicC.db, "dayCounters"))),
  );
  await t(
    "a customer cannot create a counter",
    denied(() =>
      setDoc(counterDoc(publicC, istKey(freshDay())), { next: 2, last: a }),
    ),
  );
  await t(
    "a signed-out caller cannot read a counter",
    denied(() => getDoc(counterDoc(nobodyC, key))),
  );
  await t(
    "a signed-out caller cannot write a counter",
    denied(() =>
      setDoc(counterDoc(nobodyC, istKey(freshDay())), { next: 2, last: a }),
    ),
  );
  await t(
    "a customer cannot number their own order",
    denied(async () => {
      const ref = await placeAs(publicC);
      const snap = await getDoc(doc(publicC.db, "orders", ref.id));
      const k = istKey(snap.data().createdAt.toMillis());
      await numberOrder(publicC, ref.id, k, 1);
    }),
  );
  await t(
    "a day with no counter must start at 1, not 2",
    denied(() => numberOrder(staffC, a, key, 2)),
  );
  await t(
    "a new day's counter cannot start anywhere but 2",
    denied(() => numberOrder(staffC, a, key, 1, { next: 5 })),
  );
  await t(
    "staff can number the first order of a day #1, creating its counter",
    allowed(() => numberOrder(staffC, a, key, 1)),
  );
  await t(
    "staff can read the counter back",
    allowed(async () => {
      const snap = await getDoc(counterDoc(staffC, key));
      if (snap.data()?.next !== 2) throw new Error("counter is not at 2");
    }),
  );
  await t(
    "cannot give an order a second number",
    denied(() => numberOrder(staffC, a, key, 2)),
  );
  await t(
    "cannot reuse a number already handed out",
    denied(() => numberOrder(staffC, b, key, 1, { next: 2 })),
  );
  await t(
    "cannot skip ahead (counter at 2, number 4)",
    denied(() => numberOrder(staffC, b, key, 4)),
  );
  await t(
    "cannot number an order without bumping the counter",
    denied(() => numberOrder(staffC, b, key, 2, { counter: false })),
  );
  await t(
    "cannot bump the counter by more than one alongside",
    denied(() => numberOrder(staffC, b, key, 2, { next: 4 })),
  );
  await t(
    "cannot mix numbering with a status change",
    denied(() =>
      numberOrder(staffC, b, key, 2, { extra: { status: "ready" } }),
    ),
  );
  await t(
    "cannot send a fractional number",
    denied(() => numberOrder(staffC, b, key, 2.5, { next: 3 })),
  );
  await t(
    "cannot send the number as text",
    denied(() => numberOrder(staffC, b, key, "2", { next: 3 })),
  );
  await t(
    "cannot file the order under a badly written day",
    denied(() => numberOrder(staffC, b, `${key}x`, 1)),
  );
  await t(
    "cannot file the order under the next day",
    denied(() => numberOrder(staffC, b, istKey(day + DAY_MS), 1)),
  );
  await t(
    "the owner can number an order too (counter at 2, number 2)",
    allowed(() => numberOrder(ownerC, b, key, 2)),
  );
  await t(
    "staff can take the next one (#3)",
    allowed(() => numberOrder(staffC, c, key, 3)),
  );
  await t(
    "a numbered order still moves through its statuses",
    allowed(async () => {
      await setDoc(
        doc(staffC.db, "orders", c),
        { status: "ready" },
        { merge: true },
      );
      await setDoc(
        doc(staffC.db, "orders", c),
        { status: "served" },
        { merge: true },
      );
    }),
  );
  await t(
    "a numbered order can be rejected, and keeps its number",
    allowed(async () => {
      await setDoc(
        doc(staffC.db, "orders", b),
        { status: "rejected", rejectReason: "Duplicate order" },
        { merge: true },
      );
      const snap = await getDoc(doc(staffC.db, "orders", b));
      if (snap.data()?.dayNumber !== 2) throw new Error("lost its number");
    }),
  );
  await t(
    "a status change cannot strip a number off",
    denied(() =>
      setDoc(doc(staffC.db, "orders", a), {
        ...order({ customerUid: "seeded" }),
        status: "ready",
      }),
    ),
  );
  await t(
    "the counter cannot be bumped on its own, naming an order already numbered",
    denied(() => setDoc(counterDoc(staffC, key), { next: 5, last: c })),
  );
  await t(
    "nor naming an order it does not number in the same commit",
    denied(() => setDoc(counterDoc(staffC, key), { next: 5, last: d })),
  );
  await t(
    "nor naming an order that does not exist",
    denied(() => setDoc(counterDoc(staffC, key), { next: 5, last: "nope" })),
  );
  await t(
    "nor without saying which order it is for",
    denied(() => numberOrder(staffC, d, key, 4, { last: null })),
  );
  await t(
    "the counter cannot name a different order than the one numbered",
    denied(() => numberOrder(staffC, d, key, 4, { last: e })),
  );
  await t(
    "cannot jump the counter ahead alongside a numbering",
    denied(() => numberOrder(staffC, d, key, 4, { next: 7 })),
  );
  await t(
    "or carry another field",
    denied(async () => {
      const batch = writeBatch(staffC.db);
      batch.update(doc(staffC.db, "orders", d), { dayNumber: 4, dayKey: key });
      batch.set(counterDoc(staffC, key), { next: 5, last: d, note: "x" });
      await batch.commit();
    }),
  );
  await t(
    "one commit cannot give two orders the same number (#4 twice)",
    denied(() => numberTwo(staffC, [d, e], key, 4)),
  );
  await t(
    "whichever of the two the counter names",
    denied(() => numberTwo(staffC, [d, e], key, 4, e)),
  );
  await t(
    "and neither order was numbered by the refused commit",
    allowed(async () => {
      for (const id of [d, e]) {
        const snap = await getDoc(doc(staffC.db, "orders", id));
        if (snap.data()?.dayNumber !== undefined)
          throw new Error(`${id} got a number`);
      }
    }),
  );
  await t(
    "while numbering them one commit at a time works (#4, then #5)",
    allowed(async () => {
      await numberOrder(staffC, d, key, 4);
      await numberOrder(staffC, e, key, 5);
    }),
  );
  await t(
    "the counter cannot go back, which would hand numbers out twice",
    denied(() => setDoc(counterDoc(staffC, key), { next: 2, last: a })),
  );
  await t(
    "or be deleted, even by the owner",
    denied(() => deleteDoc(counterDoc(ownerC, key))),
  );
  await t(
    "a counter cannot be filed under something that is not a day",
    denied(() =>
      setDoc(doc(staffC.db, "dayCounters", "today"), { next: 2, last: a }),
    ),
  );
}

{
  // The same attack on a day with no counter yet: two #1s, creating it.
  const day = freshDay();
  const key = istKey(day);
  const x = await seedOrderAt(day);
  const y = await seedOrderAt(day + 1000);
  await t(
    "one commit cannot give two orders #1 while creating the day's counter",
    denied(() => numberTwo(staffC, [x, y], key, 1)),
  );
  await t(
    "nor inside a transaction",
    denied(() =>
      runTransaction(staffC.db, async (tx) => {
        await tx.get(counterDoc(staffC, key));
        for (const id of [x, y])
          tx.update(doc(staffC.db, "orders", id), {
            dayNumber: 1,
            dayKey: key,
          });
        tx.set(counterDoc(staffC, key), { next: 2, last: x });
      }),
    ),
  );
  await t(
    "the legitimate #1 and #2 still go through",
    allowed(async () => {
      await numberOrder(staffC, x, key, 1);
      await numberOrder(ownerC, y, key, 2);
    }),
  );
}

{
  // The IST boundary: 18:29:59 UTC is still that day in India; 18:30 is the next.
  // Skips ahead by 3 days, and then freshDay() moves on past both: the "next
  // day" here must not be a day another test already numbered in.
  const midnight =
    Date.UTC(1999, 0, 1) - (dayCursor += 3) * DAY_MS + 18.5 * 3_600_000;
  const late = await seedOrderAt(midnight - 1000);
  const early = await seedOrderAt(midnight);
  const before = istKey(midnight - 1000);
  const after = istKey(midnight);
  await t(
    "23:59:59 IST is filed under that day, not the UTC-looking next one",
    allowed(async () => {
      if (before === after) throw new Error("test days did not differ");
      await numberOrder(staffC, late, before, 1);
    }),
  );
  await t(
    "and cannot be filed under the day after",
    denied(() => numberOrder(staffC, early, before, 2)),
  );
  await t(
    "00:00:00 IST starts the next day at #1",
    allowed(() => numberOrder(staffC, early, after, 1)),
  );
}

{
  const day = freshDay();
  const key = istKey(day);
  const full = await seedOrderAt(day);
  await seedCounter(key, 10_000);
  await t(
    "cannot hand out #10000",
    denied(() => numberOrder(staffC, full, key, 10_000)),
  );
  const zeroDay = freshDay();
  const zeroKey = istKey(zeroDay);
  const zero = await seedOrderAt(zeroDay);
  await seedCounter(zeroKey, 0);
  await t(
    "cannot hand out #0, even from a counter that says 0",
    denied(() => numberOrder(staffC, zero, zeroKey, 0, { next: 1 })),
  );
}

{
  // Two boards, one order: the transaction must give it exactly one number.
  const day = freshDay();
  const key = istKey(day);
  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push(await seedOrderAt(day + i * 1000));
  await t(
    "two boards racing for one order: one number, counter at 2",
    allowed(async () => {
      const results = await Promise.all([
        assignTx(staffC, ids[0]),
        assignTx(ownerC, ids[0]),
      ]);
      if (results.filter((r) => r !== null).length !== 1)
        throw new Error(`expected one winner, got ${results}`);
      const snap = await getDoc(counterDoc(staffC, key));
      if (snap.data()?.next !== 2) throw new Error("counter moved twice");
    }),
  );
  await t(
    "two boards racing through the rest: unique numbers in order",
    allowed(async () => {
      const board = (c) => async () => {
        for (const id of ids) await assignTx(c, id);
      };
      await Promise.all([board(staffC)(), board(ownerC)()]);
      const numbers = [];
      for (const id of ids)
        numbers.push(
          (await getDoc(doc(staffC.db, "orders", id))).data().dayNumber,
        );
      if (numbers.join() !== "1,2,3,4")
        throw new Error(`numbers came out ${numbers.join()}`);
    }),
  );
}
{
  // A new guest's order (pending) is numbered only once staff accept it, so a
  // stranger's order that is turned away never uses one of the day's numbers.
  const day = freshDay();
  const key = istKey(day);
  const guest = await seedOrderAt(day, "pending");
  await t(
    "staff cannot number an order still waiting for the counter",
    denied(() => numberOrder(staffC, guest, key, 1)),
  );
  await t(
    "nor can the owner",
    denied(() => numberOrder(ownerC, guest, key, 1)),
  );
  await t(
    "nor number it in the same commit as accepting it",
    denied(() =>
      numberOrder(staffC, guest, key, 1, { extra: { status: "preparing" } }),
    ),
  );
  await t(
    "the board's own transaction is refused on a waiting order",
    denied(() => assignTxOnce(staffC, guest)),
  );
  await t(
    "once accepted (pending -> preparing), it takes the day's first number",
    allowed(async () => {
      await setDoc(
        doc(staffC.db, "orders", guest),
        { status: "preparing" },
        { merge: true },
      );
      await numberOrder(staffC, guest, key, 1);
    }),
  );
}

// Daily numbers in the cafe's own time zone (issue #13). The rules read the
// zone's two offsets from config/site and take a day key that matches either
// (dayKeyOk). Each zone below is seeded into config/site in turn, and orders
// are placed a second either side of local midnight on real 2026 dates: on an
// ordinary day, and on each daylight-saving change day, whose two midnights are
// an hour apart from the day before's in UTC.
//
// The expected day comes from Intl, not from the app's code, so this is an
// independent check of both. Numbers come from whatever the day's counter
// says (numberUnder), so a rerun against the same emulators still works:
// only the day is under test here.
console.log("\n daily order numbers in any time zone (config/site offsets)");
const cafeDay = (zone, ms) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ms);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const shiftDay = (key, days) =>
  new Date(Date.parse(key) + days * DAY_MS).toISOString().slice(0, 10);
const setSite = async (fields) => {
  const r = await adminDoc("config/site", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: restFields({ ...SITE_SETTINGS, ...fields }),
    }),
  });
  if (!r.ok) throw new Error(`could not seed config/site: ${r.status}`);
};
const numberUnder = async (c, id, key) => {
  const counter = await getDoc(counterDoc(staffC, key));
  return numberOrder(c, id, key, counter.exists() ? counter.data().next : 1);
};

{
  // No daylight saving: one offset, and the day is exact on both sides of
  // midnight. Kathmandu is UTC+5:45, so its midnight is 18:15 UTC.
  const exact = [
    ["Asia/Kolkata", 330, "2026-06-14T18:30:00Z"],
    ["Asia/Kathmandu", 345, "2026-06-14T18:15:00Z"],
  ];
  for (const [zone, offset, iso] of exact) {
    await setSite({
      timeZone: zone,
      utcOffsets: { standard: offset, daylight: offset },
    });
    const midnight = Date.parse(iso);
    const before = cafeDay(zone, midnight - 1000);
    const after = cafeDay(zone, midnight);
    if (after !== shiftDay(before, 1))
      throw new Error(`${iso} is not midnight in ${zone}`);
    const late = await seedOrderAt(midnight - 1000);
    const early = await seedOrderAt(midnight);
    await t(
      `${zone}: 23:59:59 cannot be filed under the next day`,
      denied(() => numberUnder(staffC, late, after)),
    );
    await t(
      `${zone}: 00:00:00 cannot be filed under the day before`,
      denied(() => numberUnder(staffC, early, before)),
    );
    await t(
      `${zone}: 23:59:59 and 00:00:00 are filed under their own days`,
      allowed(async () => {
        await numberUnder(staffC, late, before);
        await numberUnder(staffC, early, after);
      }),
    );
  }
}

{
  // Daylight saving: the midnights that start and end each 2026 change day,
  // and the offset the clocks are on at each. Between midnight by one offset
  // and by the other, the two keys differ for an hour, and the rules take
  // either (the documented hour): before a midnight on standard time, the
  // next day's key is also taken; after one on daylight time, the day
  // before's. The other side of each midnight is exact.
  const changing = [
    [
      "Europe/London",
      { standard: 0, daylight: 60 },
      [
        ["2026-03-29T00:00:00Z", "standard"], // the clocks go forward today
        ["2026-03-29T23:00:00Z", "daylight"],
        ["2026-10-24T23:00:00Z", "daylight"], // the clocks go back today
        ["2026-10-26T00:00:00Z", "standard"],
      ],
    ],
    [
      "America/New_York",
      { standard: -300, daylight: -240 },
      [
        ["2026-03-08T05:00:00Z", "standard"],
        ["2026-03-09T04:00:00Z", "daylight"],
        ["2026-11-01T04:00:00Z", "daylight"],
        ["2026-11-02T05:00:00Z", "standard"],
      ],
    ],
    [
      // Southern hemisphere: back in April, forward in September.
      "Pacific/Auckland",
      { standard: 720, daylight: 780 },
      [
        ["2026-04-04T11:00:00Z", "daylight"],
        ["2026-04-05T12:00:00Z", "standard"],
        ["2026-09-26T12:00:00Z", "standard"],
        ["2026-09-27T11:00:00Z", "daylight"],
      ],
    ],
  ];
  for (const [zone, utcOffsets, midnights] of changing) {
    await setSite({ timeZone: zone, utcOffsets });
    for (const [iso, clock] of midnights) {
      const midnight = Date.parse(iso);
      const before = cafeDay(zone, midnight - 1000);
      const after = cafeDay(zone, midnight);
      if (after !== shiftDay(before, 1))
        throw new Error(`${iso} is not midnight in ${zone}`);
      if ((Date.parse(after) - midnight) / 60_000 !== utcOffsets[clock])
        throw new Error(`${iso} is not on ${clock} time in ${zone}`);
      const late = await seedOrderAt(midnight - 1000);
      const early = await seedOrderAt(midnight);
      const label = `${zone}, ${after} 00:00 (${clock} time)`;
      if (clock === "standard") {
        await t(
          `${label}: 00:00:00 cannot be filed under the day before`,
          denied(() => numberUnder(staffC, early, before)),
        );
        // An hour before: outside the documented hour, so exact too.
        const earlier = await seedOrderAt(midnight - 3_601_000);
        await t(
          `${label}: 22:59:59 cannot be filed under the next day`,
          denied(() => numberUnder(staffC, earlier, after)),
        );
        const window = await seedOrderAt(midnight - 1000);
        await t(
          `${label}: 23:59:59 may also go under the next day (the documented hour)`,
          allowed(() => numberUnder(staffC, window, after)),
        );
      } else {
        await t(
          `${label}: 23:59:59 cannot be filed under the next day`,
          denied(() => numberUnder(staffC, late, after)),
        );
        const later = await seedOrderAt(midnight + 3_600_000);
        await t(
          `${label}: 01:00:00 cannot be filed under the day before`,
          denied(() => numberUnder(staffC, later, before)),
        );
        const window = await seedOrderAt(midnight);
        await t(
          `${label}: 00:00:00 may also go under the day before (the documented hour)`,
          allowed(() => numberUnder(staffC, window, before)),
        );
      }
      await t(
        `${label}: 23:59:59 and 00:00:00 are filed under their own days`,
        allowed(async () => {
          await numberUnder(staffC, late, before);
          await numberUnder(staffC, early, after);
        }),
      );
      await t(
        `${label}: nor can an order be filed two days off`,
        denied(async () => {
          const stray = await seedOrderAt(midnight);
          await numberUnder(staffC, stray, shiftDay(after, 1));
        }),
      );
    }
  }
}

{
  // The board's own transaction in a daylight-saving zone, end to end: it
  // files the order under the cafe's day, which here differs from both the
  // UTC date and India's. 00:30 BST on 30 March is 23:30 UTC on the 29th.
  await setSite({
    timeZone: "Europe/London",
    utcOffsets: { standard: 0, daylight: 60 },
  });
  const id = await seedOrderAt(Date.parse("2026-03-29T23:30:00Z"));
  await t(
    "the board's transaction numbers a London order under London's day",
    allowed(async () => {
      await runTransaction(staffC.db, async (tx) => {
        const orderRef = doc(staffC.db, "orders", id);
        const o = await tx.get(orderRef);
        const key = cafeDay("Europe/London", o.data().createdAt.toMillis());
        if (key !== "2026-03-30") throw new Error(`keyed ${key}`);
        const cRef = counterDoc(staffC, key);
        const counter = await tx.get(cRef);
        const n = counter.exists() ? counter.data().next : 1;
        tx.update(orderRef, { dayNumber: n, dayKey: key });
        tx.set(cRef, { next: n + 1, last: id });
      });
    }),
  );
}

{
  // TOE's projects have no config/site: the day is India's, as it always was.
  // 18:45 UTC on 20 June is 00:15 on the 21st in India.
  await adminDoc("config/site", { method: "DELETE" });
  const ms = Date.parse("2026-06-20T18:45:00Z");
  const a = await seedOrderAt(ms);
  const b = await seedOrderAt(ms);
  await t(
    "with no config/site, an order is filed under India's day",
    allowed(() => numberUnder(staffC, a, "2026-06-21")),
  );
  await t(
    "and not under the UTC date",
    denied(() => numberUnder(staffC, b, "2026-06-20")),
  );

  // A config/site the platform got wrong refuses numbering rather than
  // guessing a day.
  await setSite({ utcOffsets: { standard: "330", daylight: "330" } });
  await t(
    "offsets that are not whole numbers refuse numbering",
    denied(() => numberUnder(staffC, b, "2026-06-21")),
  );
  await setSite({});
  await t(
    "and the settings put right, the same order numbers",
    allowed(() => numberUnder(staffC, b, "2026-06-21")),
  );
}

// -- order caps per currency (#12) -------------------------------------------
// The total's bound is config/site's maxOrderTotal, an integer in the cafe's
// own money unit (orderWithinCap). With none, TOE's 10,000 whole rupees.
console.log("\n order caps per currency (config/site maxOrderTotal)");
{
  const capped = (total, price = total) => ({
    items: [line({ qty: 1, price })],
    total,
  });
  // Exactly these fields, nothing merged in: setSite always adds the seeded
  // settings, which with CAFE_FIXTURE=toe carry a cap of their own.
  const putSite = async (fields) => {
    const r = await adminDoc("config/site", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: restFields(fields) }),
    });
    if (!r.ok) throw new Error(`could not seed config/site: ${r.status}`);
  };
  const minor = { schemaVersion: 2, moneyUnit: "minor" };
  const currencies = [
    ["INR in paise (₹10,000)", "INR", "en-IN", 1_000_000],
    ["USD in cents ($150)", "USD", "en-US", 15_000],
    ["JPY, no minor unit (¥20,000)", "JPY", "ja-JP", 20_000],
  ];
  for (const [label, currency, locale, cap] of currencies) {
    await setSite({ ...minor, currency, locale, maxOrderTotal: cap });
    await t(
      `${label}: an order of exactly the cap is taken`,
      allowed(() => placeAs(publicC, capped(cap))),
    );
    await t(
      `${label}: one more is refused`,
      denied(() => placeAs(publicC, capped(cap + 1))),
    );
  }
  await t(
    "a first line dearer than the cap is refused, whatever the total says",
    denied(() => placeAs(publicC, capped(1, 20_001))),
  );
  await t(
    "a cafe in paise takes the ₹150 order TOE's whole-rupee cap would refuse",
    allowed(() => placeAs(publicC, capped(15_000))),
  );

  // TOE's settings from before #12: no cap, so 10,000, as the rule always said.
  const before = { ...SITE_SETTINGS, schemaVersion: 1 };
  delete before.maxOrderTotal;
  delete before.moneyUnit;
  await putSite(before);
  await t(
    "config/site with no cap (TOE before #12): 10,000 is taken",
    allowed(() => placeAs(publicC, capped(10_000))),
  );
  await t(
    "and 10,001 is refused",
    denied(() => placeAs(publicC, capped(10_001))),
  );
  await adminDoc("config/site", { method: "DELETE" });
  await t(
    "no config/site at all: 10,000 is taken",
    allowed(() => placeAs(publicC, capped(10_000))),
  );
  await t(
    "and 10,001 is refused",
    denied(() => placeAs(publicC, capped(10_001))),
  );
  // A cap the platform got wrong refuses orders rather than guess one.
  await setSite({ maxOrderTotal: "1000000" });
  await t(
    "a cap that is not a number refuses every order",
    denied(() => placeAs(publicC, capped(100))),
  );
  await setSite({});
}

// -- open tables: staff confirm new guests (src/lib/table-open.ts) ----------
console.log("\n open tables (tableSessions) and pending orders");
const HOUR = 3600_000;
const sessionDoc = (c, n) => doc(c.db, "tableSessions", String(n));
const openFor = (ms) => ({ openUntil: Timestamp.fromMillis(Date.now() + ms) });
const pending = (o = {}) => ({ status: "pending", ...o });

// The default: no config/ordering at all means approval is OFF, so a
// `preparing` order from a closed table goes straight to the kitchen.
await adminDoc("config/ordering", { method: "DELETE" });
await t(
  "with no config/ordering (the default), a preparing order from a closed table is taken",
  allowed(() => placeAs(publicC, { tableNumber: 10 })),
);
await t(
  "and a pending one is still taken too",
  allowed(() => placeAs(publicC, pending({ tableNumber: 10 }))),
);
await seedOrdering({});
await t(
  "a config/ordering without confirmNewGuests also means off",
  allowed(() => placeAs(publicC, { tableNumber: 10 })),
);
await seedOrdering({ confirmNewGuests: { booleanValue: true } });
await t(
  "with confirmNewGuests = true, a preparing order from a closed table is refused",
  denied(() => placeAs(publicC, { tableNumber: 10 })),
);
await t(
  "and it must come in as pending",
  allowed(() => placeAs(publicC, pending({ tableNumber: 10 }))),
);

await t(
  "a customer can place a pending order on a closed table",
  allowed(() => placeAs(publicC, pending({ tableNumber: 10 }))),
);
await t(
  "a pending order still needs the table's code",
  denied(() => placeAs(publicC, pending(keyed({ tableKey: undefined })))),
);
await t(
  "a pending order still has the size caps",
  denied(() => placeAs(publicC, pending({ tableNumber: 10, total: 10001 }))),
);
await t(
  "a pending order is still throttled",
  denied(async () => {
    const uid = (await freshCustomer(publicC)).uid;
    await seedStamp(uid, 5);
    await commitOrder(publicC, pending({ tableNumber: 10 }));
  }),
);
await t(
  "a preparing order is refused on a table with no session",
  denied(() => placeAs(publicC, { tableNumber: 10 })),
);
await t(
  "a preparing order is refused on a table whose time ran out",
  denied(() => placeAs(publicC, { tableNumber: 12 })),
);
await t(
  "a preparing order is taken on an open table",
  allowed(() => placeAs(publicC, { tableNumber: 3 })),
);
await t(
  "an order cannot start as received",
  denied(() => placeAs(publicC, { tableNumber: 3, status: "received" })),
);
await t(
  "anyone can read whether a table is open",
  allowed(() => getDoc(sessionDoc(nobodyC, 3))),
);
await t(
  "a customer can read their own table's session (a get)",
  allowed(() => getDoc(sessionDoc(publicC, 3))),
);
await t(
  "a signed-out caller cannot list the open tables",
  denied(() => getDocs(collection(nobodyC.db, "tableSessions"))),
);
await t(
  "a customer cannot list the open tables either",
  denied(() => getDocs(collection(publicC.db, "tableSessions"))),
);
await t(
  "staff can list the open tables (the board's listener)",
  allowed(() => getDocs(collection(staffC.db, "tableSessions"))),
);
await t(
  "and so can the owner",
  allowed(() => getDocs(collection(ownerC.db, "tableSessions"))),
);
await t(
  "anyone can read the confirm-new-guests setting",
  allowed(() => getDoc(doc(nobodyC.db, "config", "ordering"))),
);
await t(
  "a customer cannot open a table",
  denied(async () => {
    await freshCustomer(publicC);
    await setDoc(sessionDoc(publicC, 10), openFor(HOUR));
  }),
);
await t(
  "a signed-out caller cannot open a table",
  denied(() => setDoc(sessionDoc(nobodyC, 10), openFor(HOUR))),
);
await t(
  "a customer cannot close a table",
  denied(() =>
    setDoc(sessionDoc(publicC, 3), { openUntil: serverTimestamp() }),
  ),
);
await t(
  "a customer cannot switch confirmation off",
  denied(() =>
    setDoc(doc(publicC.db, "config", "ordering"), { confirmNewGuests: false }),
  ),
);
await t(
  "a barista cannot switch confirmation off",
  denied(() =>
    setDoc(doc(staffC.db, "config", "ordering"), { confirmNewGuests: false }),
  ),
);
await t(
  "a customer cannot accept their own pending order",
  denied(async () => {
    const ref = await placeAs(publicC, pending({ tableNumber: 10 }));
    await setDoc(
      doc(publicC.db, "orders", ref.id),
      { status: "preparing" },
      { merge: true },
    );
  }),
);
// Accept, as firestoreOrderRepo.accept() does it: the order and the table in
// one commit.
const accept = async (c, table, ms = 3 * HOUR) => {
  const ref = await placeAs(publicC, pending({ tableNumber: table }));
  const batch = writeBatch(c.db);
  batch.update(doc(c.db, "orders", ref.id), { status: "preparing" });
  batch.set(sessionDoc(c, table), openFor(ms));
  await batch.commit();
  return ref;
};
await t(
  "staff accept a pending order and open its table in one commit",
  allowed(() => accept(staffC, 13)),
);
await t(
  "and the table's next order goes straight to preparing",
  allowed(() => placeAs(publicC, { tableNumber: 13 })),
);
await t(
  "staff can keep an open table open (3 more hours)",
  allowed(() => setDoc(sessionDoc(staffC, 13), openFor(3 * HOUR))),
);
await t(
  "staff can open a table up to 4 hours ahead",
  allowed(() => setDoc(sessionDoc(staffC, 13), openFor(4 * HOUR - 60_000))),
);
await t(
  "staff cannot open a table for more than 4 hours",
  denied(() => setDoc(sessionDoc(staffC, 13), openFor(5 * HOUR))),
);
await t(
  "staff cannot accept and open a table for too long in one commit",
  denied(() => accept(staffC, 14, 5 * HOUR)),
);
await t(
  "staff cannot set a closing time in the past",
  denied(() => setDoc(sessionDoc(staffC, 13), openFor(-10 * 60_000))),
);
await t(
  "staff cannot add other fields to a table",
  denied(() =>
    setDoc(sessionDoc(staffC, 13), { ...openFor(HOUR), by: "barista" }),
  ),
);
await t(
  "staff cannot store the time as a number",
  denied(() =>
    setDoc(sessionDoc(staffC, 13), { openUntil: Date.now() + HOUR }),
  ),
);
await t(
  "staff cannot open a table above 50",
  denied(() => setDoc(sessionDoc(staffC, 51), openFor(HOUR))),
);
await t(
  "staff cannot open something that is not a table",
  denied(() => setDoc(doc(staffC.db, "tableSessions", "abc"), openFor(HOUR))),
);
await t(
  "staff cannot delete a table's session",
  denied(() => deleteDoc(sessionDoc(staffC, 13))),
);
await t(
  "staff can close a table now",
  allowed(() =>
    setDoc(sessionDoc(staffC, 13), { openUntil: serverTimestamp() }),
  ),
);
await t(
  "after which a preparing order is refused again",
  denied(() => placeAs(publicC, { tableNumber: 13 })),
);
await t(
  "while a pending order is still taken",
  allowed(() => placeAs(publicC, pending({ tableNumber: 13 }))),
);
await t(
  "the owner can accept too",
  allowed(() => accept(ownerC, 14)),
);
{
  // Two phones at one table, both before Accept: the board accepts every
  // waiting order of that table in the same commit as opening it, and the
  // board then numbers each of them (src/app/staff/page.tsx, advance()).
  const a = await placeAs(publicC, pending({ tableNumber: 11 }));
  const b = await placeAs(publicC, pending({ tableNumber: 11 }));
  await t(
    "staff accept two waiting orders of one table and open it, in one commit",
    allowed(async () => {
      const batch = writeBatch(staffC.db);
      batch.update(doc(staffC.db, "orders", a.id), { status: "preparing" });
      batch.update(doc(staffC.db, "orders", b.id), { status: "preparing" });
      batch.set(sessionDoc(staffC, 11), openFor(3 * HOUR));
      await batch.commit();
    }),
  );
  await t(
    "and the board can then number both",
    allowed(async () => {
      const na = await assignTx(staffC, a.id);
      const nb = await assignTx(staffC, b.id);
      if (!(Number.isInteger(na) && nb === na + 1))
        throw new Error(`numbers came out ${na}, ${nb}`);
    }),
  );
  // A tablet whose clock runs more than an hour fast: moving an open table's
  // order on together with keeping the table open is refused (openUntil too
  // far ahead), and the board retries the plain status change, which works.
  await t(
    "a status change bundled with an openUntil beyond 4h is refused",
    denied(async () => {
      const batch = writeBatch(staffC.db);
      batch.update(doc(staffC.db, "orders", a.id), { status: "ready" });
      batch.set(sessionDoc(staffC, 11), openFor(4 * HOUR + 30 * 60_000));
      await batch.commit();
    }),
  );
  await t(
    "while the plain status change on its own is taken",
    allowed(() =>
      setDoc(
        doc(staffC.db, "orders", a.id),
        { status: "ready" },
        { merge: true },
      ),
    ),
  );
}
await t(
  "staff can reject a pending order, with a reason",
  allowed(async () => {
    const ref = await placeAs(publicC, pending({ tableNumber: 10 }));
    await setDoc(
      doc(staffC.db, "orders", ref.id),
      { status: "rejected", rejectReason: "No one at this table" },
      { merge: true },
    );
  }),
);
await t(
  "staff cannot move a pending order straight to ready",
  denied(async () => {
    const ref = await placeAs(publicC, pending({ tableNumber: 10 }));
    await setDoc(
      doc(staffC.db, "orders", ref.id),
      { status: "ready" },
      { merge: true },
    );
  }),
);
await t(
  "staff cannot complete a pending order",
  denied(async () => {
    const ref = await placeAs(publicC, pending({ tableNumber: 10 }));
    await setDoc(
      doc(staffC.db, "orders", ref.id),
      { status: "completed", completedAt: serverTimestamp() },
      { merge: true },
    );
  }),
);
const orderingDoc = (c) => doc(c.db, "config", "ordering");
await t(
  "the owner can switch confirmation off",
  allowed(() => setDoc(orderingDoc(ownerC), { confirmNewGuests: false })),
);
await t(
  "with it off, a preparing order is taken on a closed table",
  allowed(() => placeAs(publicC, { tableNumber: 10 })),
);
await t(
  "the owner cannot save the switch as text",
  denied(() => setDoc(orderingDoc(ownerC), { confirmNewGuests: "no" })),
);
await t(
  "the owner cannot add other fields to the switch",
  denied(() => setDoc(orderingDoc(ownerC), { confirmNewGuests: false, x: 1 })),
);
await t(
  "the owner can switch confirmation back on",
  allowed(() => setDoc(orderingDoc(ownerC), { confirmNewGuests: true })),
);
await t(
  "with it on again, a preparing order on a closed table is refused",
  denied(() => placeAs(publicC, { tableNumber: 10 })),
);
await t(
  "the owner can delete the switch (back to the default, OFF)",
  allowed(() => deleteDoc(orderingDoc(ownerC))),
);
await t(
  "and then a preparing order on a closed table is taken again",
  allowed(() => placeAs(publicC, { tableNumber: 10 })),
);

// Staff invites (issue #15). Runs after the barista has its staff record, so
// "a barista cannot…" is a staff account being refused, not a stranger.
console.log("\n invites (the owner adds staff by link)");
const joinC = app("joiner");
const join2C = app("second-joiner");
const joinAcct = await account("join@cafe.test");
const join2Acct = await account("join2@cafe.test");
// The emulators keep data between runs: whoever joined last time starts this
// run as a stranger again.
for (const acct of [joinAcct, join2Acct]) {
  await fetch(
    `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${acct.localId}`,
    { method: "DELETE", headers: { Authorization: "Bearer owner" } },
  );
}
await signInWithEmailAndPassword(joinC.auth, "join@cafe.test", "correct-horse");
await signInWithEmailAndPassword(
  join2C.auth,
  "join2@cafe.test",
  "correct-horse",
);
const ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// As src/lib/invites.ts makes them: 24 random letters and digits.
const newInviteId = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (b) => ID_CHARS[b % 62],
  ).join("");
const invite = (o = {}) => ({
  role: "staff",
  createdBy: ownerAcct.localId,
  createdAt: serverTimestamp(),
  usedBy: null,
  usedAt: null,
  ...o,
});
const makeInvite = async (role = "staff") => {
  const id = newInviteId();
  await setDoc(doc(ownerC.db, "invites", id), invite({ role }));
  return id;
};
// Mirrors firestoreStaffRepo.join() in src/lib/data/firestore.ts: the
// caller's /staff record and the invite's usedBy in one batch. `staff` and
// `spend` override fields of each half; `only` sends just one half.
const join = (c, id, { staff = {}, spend = {}, uid, only } = {}) => {
  const me = c.auth.currentUser;
  const batch = writeBatch(c.db);
  if (only !== "invite")
    batch.set(doc(c.db, "staff", uid ?? me.uid), {
      name: "Asha",
      role: "staff",
      email: me.email ?? "anon@cafe.test",
      invite: id,
      ...staff,
    });
  if (only !== "staff")
    batch.update(doc(c.db, "invites", id), {
      usedBy: me.uid,
      usedAt: serverTimestamp(),
      ...spend,
    });
  return batch.commit();
};

let staffInvite;
let ownerInvite;
await t(
  "the owner can make a staff invite",
  allowed(async () => {
    staffInvite = await makeInvite("staff");
  }),
);
await t(
  "the owner can make an owner invite",
  allowed(async () => {
    ownerInvite = await makeInvite("owner");
  }),
);
await t(
  "a barista cannot make an invite",
  denied(() =>
    setDoc(
      doc(staffC.db, "invites", newInviteId()),
      invite({ createdBy: staffAcct.localId }),
    ),
  ),
);
await t(
  "a customer cannot make an invite",
  denied(() =>
    setDoc(
      doc(publicC.db, "invites", newInviteId()),
      invite({ createdBy: publicC.user.uid }),
    ),
  ),
);
await t(
  "the owner cannot make an invite with a guessable id",
  denied(() => setDoc(doc(ownerC.db, "invites", "abc123"), invite())),
);
await t(
  "the owner cannot make an invite that starts out used",
  denied(() =>
    setDoc(
      doc(ownerC.db, "invites", newInviteId()),
      invite({ usedBy: joinAcct.localId }),
    ),
  ),
);
await t(
  "the owner cannot pick an invite's start, to make it last longer",
  denied(() =>
    setDoc(
      doc(ownerC.db, "invites", newInviteId()),
      invite({ createdAt: Timestamp.fromMillis(Date.now() + 86_400_000) }),
    ),
  ),
);
await t(
  "the owner cannot make an invite for a role that does not exist",
  denied(() =>
    setDoc(doc(ownerC.db, "invites", newInviteId()), invite({ role: "admin" })),
  ),
);
await t(
  "anyone with the link can read the invite",
  allowed(() => getDoc(doc(nobodyC.db, "invites", staffInvite))),
);
await t(
  "a barista cannot list invites (each id is a usable code)",
  denied(() => getDocs(collection(staffC.db, "invites"))),
);
await t(
  "a customer cannot list invites",
  denied(() => getDocs(collection(publicC.db, "invites"))),
);
await t(
  "the owner can list invites",
  allowed(() => getDocs(collection(ownerC.db, "invites"))),
);
await t(
  "a barista cannot cancel an invite",
  denied(() => deleteDoc(doc(staffC.db, "invites", staffInvite))),
);

await t(
  "a staff invite cannot be used to become owner",
  denied(() => join(joinC, staffInvite, { staff: { role: "owner" } })),
);
await t(
  "nor by rewriting the invite's role on the way",
  denied(() =>
    join(joinC, staffInvite, {
      staff: { role: "owner" },
      spend: { role: "owner" },
    }),
  ),
);
await t(
  "joining needs the invite spent in the same commit",
  denied(() => join(joinC, staffInvite, { only: "staff" })),
);
await t(
  "an invite cannot be spent without joining",
  denied(() => join(joinC, staffInvite, { only: "invite" })),
);
await t(
  "a new account cannot join on someone else's behalf",
  denied(() =>
    join(joinC, staffInvite, {
      uid: join2Acct.localId,
      spend: { usedBy: join2Acct.localId },
      staff: { email: "join2@cafe.test" },
    }),
  ),
);
await t(
  "a new account cannot mark the invite used by someone else",
  denied(() =>
    join(joinC, staffInvite, { spend: { usedBy: join2Acct.localId } }),
  ),
);
await t(
  "a new account cannot claim someone else's email",
  denied(() =>
    join(joinC, staffInvite, { staff: { email: "owner@cafe.test" } }),
  ),
);
await t(
  "a new account cannot join with no name",
  denied(() => join(joinC, staffInvite, { staff: { name: "" } })),
);
await t(
  "a new account cannot add other fields to its record",
  denied(() => join(joinC, staffInvite, { staff: { pay: 100 } })),
);
await t(
  "a customer's anonymous session cannot join",
  denied(() => join(publicC, staffInvite)),
);
await t(
  "a new account can join with a staff invite",
  allowed(() => join(joinC, staffInvite)),
);
await t(
  "and is then staff: it can read the order board",
  allowed(() => getDocs(collection(joinC.db, "orders"))),
);
await t(
  "but not the owner's things",
  denied(() => getDocs(collection(joinC.db, "invites"))),
);
await t(
  "a staff member cannot edit their own role",
  denied(() =>
    updateDoc(doc(joinC.db, "staff", joinAcct.localId), { role: "owner" }),
  ),
);
await t(
  "nor use an owner invite to become owner",
  denied(() => join(joinC, ownerInvite, { staff: { role: "owner" } })),
);
await t(
  "an invite cannot be used twice",
  denied(() => join(join2C, staffInvite)),
);
await t(
  "an expired invite is refused",
  denied(async () => {
    // Made eight days ago, which only the emulator's admin can do.
    const id = newInviteId();
    const r = await fetch(
      `http://${HOST}:${FS_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/invites/${id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            role: { stringValue: "staff" },
            createdBy: { stringValue: ownerAcct.localId },
            createdAt: {
              timestampValue: new Date(
                Date.now() - 8 * 86_400_000,
              ).toISOString(),
            },
            usedBy: { nullValue: null },
            usedAt: { nullValue: null },
          },
        }),
      },
    );
    if (!r.ok) throw new Error(`could not seed the invite: ${r.status}`);
    await join(join2C, id);
  }),
);
await t(
  "a cancelled invite is refused",
  denied(async () => {
    const id = await makeInvite("staff");
    await deleteDoc(doc(ownerC.db, "invites", id));
    await join(join2C, id);
  }),
);
await t(
  "an owner invite makes an owner",
  allowed(() => join(join2C, ownerInvite, { staff: { role: "owner" } })),
);
await t(
  "who can then edit the menu",
  allowed(() =>
    addDoc(collection(join2C.db, "menu"), { name: "Flat white", price: 160 }),
  ),
);

await t(
  "the owner can change someone's role",
  allowed(() =>
    updateDoc(doc(ownerC.db, "staff", joinAcct.localId), { role: "owner" }),
  ),
);
await t(
  "and change it back",
  allowed(() =>
    updateDoc(doc(ownerC.db, "staff", joinAcct.localId), { role: "staff" }),
  ),
);
await t(
  "a barista cannot remove someone",
  denied(() => deleteDoc(doc(staffC.db, "staff", joinAcct.localId))),
);
await t(
  "the owner can remove someone",
  allowed(() => deleteDoc(doc(ownerC.db, "staff", joinAcct.localId))),
);
await t(
  "a removed account can no longer read the order board",
  denied(() => getDocs(collection(joinC.db, "orders"))),
);
await t(
  "nor come back with its old invite",
  denied(() => join(joinC, staffInvite)),
);
await t(
  "the owner can clear away a used invite",
  allowed(() => deleteDoc(doc(ownerC.db, "invites", staffInvite))),
);

// -- maintenance (#78) -------------------------------------------------------
// While config/site.maintenance (the admin's) or config/ownerMaintenance (the
// owner's) is in effect, no new order is taken, from any client; everything
// else works. Each order below is a raw client write (commitOrder), as a saved
// link or a modified page would send it.
console.log("\n maintenance mode (the admin's and the owner's)");
{
  const HOUR = 3_600_000;
  const ago = (ms) => new Date(Date.now() - ms);
  const ahead = (ms) => new Date(Date.now() + ms);
  const adminMaintenance = (o = {}) => ({
    on: true,
    by: "admin",
    message: "Back after a short update.",
    until: null,
    startsAt: null,
    endsAt: null,
    ...o,
  });
  const ownerMaintenanceDoc = (c) => doc(c.db, "config", "ownerMaintenance");
  const ownerMaintenance = (o = {}) => ({
    on: true,
    by: "owner",
    message: "Closed for Diwali.",
    until: null,
    startsAt: null,
    endsAt: null,
    updatedAt: serverTimestamp(),
    ...o,
  });
  await adminDoc("config/ownerMaintenance", { method: "DELETE" });

  // An order placed before, by a customer of its own, to see their status
  // screen and the staff board carry on with it.
  const regular = app("maintenance-regular");
  await signInAnonymously(regular.auth);
  const before = await commitOrder(regular);

  await setSite({ maintenance: adminMaintenance() });
  await t(
    "the admin's maintenance: a new order is refused, even sent straight to the database",
    denied(() => placeAs(publicC)),
  );
  await t(
    "…and a pending one too",
    denied(() => placeAs(publicC, { status: "pending" })),
  );
  await t(
    "an order placed before still shows its live status to its customer",
    allowed(() => getDoc(doc(regular.db, "orders", before.id))),
  );
  await t(
    "the staff board still reads the orders",
    allowed(() => getDocs(collection(staffC.db, "orders"))),
  );
  await t(
    "…and moves an order placed before along",
    allowed(() =>
      setDoc(
        doc(staffC.db, "orders", before.id),
        { status: "ready" },
        { merge: true },
      ),
    ),
  );
  await t(
    "the owner's dashboard still edits the menu",
    allowed(() =>
      setDoc(doc(ownerC.db, "menu", "maintenance-test"), {
        name: "Chai",
        price: 3000,
        category: "Tea",
        available: true,
      }),
    ),
  );
  await t(
    "anyone can read the maintenance, for the customer's page",
    allowed(async () => {
      const snap = await getDoc(siteDoc(nobodyC));
      if (snap.data().maintenance?.on !== true) throw new Error("not there");
    }),
  );
  await t(
    "the owner cannot clear the admin's maintenance",
    denied(() => updateDoc(siteDoc(ownerC), { maintenance: null })),
  );
  await t(
    "…nor overwrite config/site",
    denied(() => setDoc(siteDoc(ownerC), { name: "Mine" })),
  );
  await t(
    "…nor delete it",
    denied(() => deleteDoc(siteDoc(ownerC))),
  );
  await t(
    "…nor can staff",
    denied(() => updateDoc(siteDoc(staffC), { maintenance: null })),
  );

  // The schedule, by the server's clock.
  await setSite({ maintenance: adminMaintenance({ startsAt: ahead(HOUR) }) });
  await t(
    "scheduled: before its start, orders are taken",
    allowed(() => placeAs(publicC)),
  );
  await setSite({
    maintenance: adminMaintenance({
      startsAt: ago(HOUR),
      endsAt: ahead(HOUR),
    }),
  });
  await t(
    "scheduled: between its start and its end, they're refused",
    denied(() => placeAs(publicC)),
  );
  await setSite({
    maintenance: adminMaintenance({
      startsAt: ago(2 * HOUR),
      endsAt: ago(HOUR),
    }),
  });
  await t(
    "scheduled: after its end, they're taken again",
    allowed(() => placeAs(publicC)),
  );
  await setSite({ maintenance: adminMaintenance({ startsAt: "8pm" }) });
  await t(
    "a schedule that isn't one refuses orders rather than guess",
    denied(() => placeAs(publicC)),
  );
  await setSite({ maintenance: { ...adminMaintenance(), on: false } });
  await t(
    "maintenance switched off: orders are taken",
    allowed(() => placeAs(publicC)),
  );
  await setSite({ maintenance: null });
  await t(
    "no maintenance at all: orders are taken",
    allowed(() => placeAs(publicC)),
  );

  // The owner's own.
  await t(
    "the owner turns their own maintenance on from the dashboard",
    allowed(() => setDoc(ownerMaintenanceDoc(ownerC), ownerMaintenance())),
  );
  await t(
    "…and a new order is refused",
    denied(() => placeAs(publicC)),
  );
  await t(
    "…while staff keep working",
    allowed(() => getDocs(collection(staffC.db, "orders"))),
  );
  await t(
    "anyone can read it, for the customer's page",
    allowed(() => getDoc(ownerMaintenanceDoc(nobodyC))),
  );
  await t(
    "the owner turns it off",
    allowed(() =>
      setDoc(ownerMaintenanceDoc(ownerC), ownerMaintenance({ on: false })),
    ),
  );
  await t(
    "…and orders are taken again",
    allowed(() => placeAs(publicC)),
  );
  await t(
    "the owner schedules theirs",
    allowed(() =>
      setDoc(
        ownerMaintenanceDoc(ownerC),
        ownerMaintenance({ startsAt: ahead(HOUR), endsAt: ahead(3 * HOUR) }),
      ),
    ),
  );
  await t(
    "…and it hasn't started yet",
    allowed(() => placeAs(publicC)),
  );
  for (const [what, fields] of [
    ["as if it were the admin's", { by: "admin" }],
    ["with a message too long", { message: "x".repeat(281) }],
    [
      "ending before it starts",
      { startsAt: ahead(2 * HOUR), endsAt: ahead(HOUR) },
    ],
    ["with a start that isn't a time", { startsAt: "8pm" }],
    ["dated by the phone's clock", { updatedAt: new Date() }],
    ["with more than it takes", { reason: "abuse" }],
  ]) {
    await t(
      `the owner cannot save theirs ${what}`,
      denied(() =>
        setDoc(ownerMaintenanceDoc(ownerC), ownerMaintenance(fields)),
      ),
    );
  }
  await t(
    "staff cannot turn the owner's maintenance on or off",
    denied(() => setDoc(ownerMaintenanceDoc(staffC), ownerMaintenance())),
  );
  await t(
    "nor can a customer",
    denied(() => setDoc(ownerMaintenanceDoc(publicC), ownerMaintenance())),
  );

  // Both on: the owner ending theirs leaves the admin's in force.
  await setDoc(ownerMaintenanceDoc(ownerC), ownerMaintenance());
  await setSite({ maintenance: adminMaintenance() });
  await t(
    "the owner can delete their own maintenance",
    allowed(() => deleteDoc(ownerMaintenanceDoc(ownerC))),
  );
  await t(
    "…but with the admin's still on, orders are still refused",
    denied(() => placeAs(publicC)),
  );
  await setSite({ maintenance: null });
  await t(
    "once the admin ends theirs, orders are taken",
    allowed(() => placeAs(publicC)),
  );
  await deleteDoc(doc(ownerC.db, "menu", "maintenance-test"));
  await deleteApp(regular.a);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  - ${f}`);
await Promise.all(
  [
    publicC.a,
    nobodyC.a,
    otherCustomerC.a,
    throttleC.a,
    loner.a,
    tempC.a,
    staffC.a,
    ownerC.a,
    joinC.a,
    join2C.a,
  ].map(deleteApp),
);
process.exit(failures.length ? 1 : 0);

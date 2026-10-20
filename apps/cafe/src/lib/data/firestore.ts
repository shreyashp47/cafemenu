/**
 * Firestore implementation of the storage contracts, matching the collection
 * layout in docs/requirements.md §8:
 *
 *   /orders/{orderId}  tableNumber, items[{name,qty,price}], total, status,
 *                      createdAt, completedAt?, paymentMethod
 *   /menu/{itemId}     name, description?, price, category, available
 *   /config/special   the "today's special" board
 *   /config/tables    { tables: number[] }, the owner's table list
 *   /tableKeys/{n}    { key }, table n's QR code; owner-only (table-keys.ts)
 *   /tableSessions/{n} { openUntil }, table n is open until then; public
 *                     read, staff write (table-open.ts)
 *   /config/ordering  { confirmNewGuests }, the owner's switch (table-open.ts)
 *
 *   /dayCounters/{YYYY-MM-DD}  { next, last }: today's order numbers; staff-only
 *
 * There is no /meta/counters any more (issue #30). Orders get their daily
 * number (#0001…) from the staff board, in a transaction on /dayCounters
 * (src/lib/day-number.ts); older orders fall back to a stored or derived
 * number (src/lib/order-number.ts).
 *
 * `onSnapshot` powers the live staff board and the customer's status screen
 * (§5.3) with no separate realtime service. The module is only ever imported
 * when the Firebase env block is present (see ./index.ts).
 */

import { getDemoStaffPin } from "../config";
import { orderTotal } from "../money";
import { ACTIVE_STATUSES, MAX_REJECT_REASON } from "../order-status";
import { assignInTransaction, counterNext } from "../day-number";
import { isTableKey } from "../table-keys";
import {
  parseOrderingSettings,
  looksOpen,
  parseTableSessionsDoc,
  type TableSessions,
} from "../table-open";
import { OrderThrottled, throttleFromServerStamp } from "../order-throttle";
import { checkTablesForSave, normalizeTables } from "../tables";
import { roleFromStaffDoc, staffDisplayName } from "./roles";
import {
  parseMenuItem,
  parseOrder,
  parseSpecialOffer,
  type MenuItem,
  type Order,
  type SpecialOffer,
  type Unsubscribe,
} from "../types";
import type {
  AuthRepository,
  ConfigRepository,
  Listener,
  MenuRepository,
  MenuWriteInput,
  NewOrderInput,
  OrderRepository,
  SessionRepository,
  StaffRole,
} from "./types";

type Firestore = import("firebase/firestore").Firestore;
type DocData = import("firebase/firestore").DocumentData;
type DocSnap = import("firebase/firestore").DocumentSnapshot<DocData>;
type FsModule = typeof import("firebase/firestore");

const MENU = "menu";
const ORDERS = "orders";
const CONFIG = "config";
const SPECIAL_DOC = "special";
const TABLES_DOC = "tables";
const STAFF = "staff";
const THROTTLE = "orderThrottle";
const TABLE_KEYS = "tableKeys";
const DAY_COUNTERS = "dayCounters";
const SESSIONS = "tableSessions";
const ORDERING_DOC = "ordering";

let bundle: Promise<{
  app: import("firebase/app").FirebaseApp;
  auth: import("firebase/auth").Auth;
  db: Firestore;
  fs: FsModule;
}> | null = null;

function getBundle() {
  bundle ??= (async () => {
    const [mod, fs] = await Promise.all([
      import("./firebase").then((m) => m.default()),
      import("firebase/firestore"),
    ]);
    return { ...mod, fs };
  })();
  return bundle;
}

async function dbAndFs(): Promise<{ db: Firestore; fs: FsModule }> {
  const { db, fs } = await getBundle();
  return { db, fs };
}

/**
 * The identity a customer order is pinned to.
 *
 * A customer has no account (requirements §3), but "no account" cannot mean "no
 * identity" if the order rules are to let somebody read back their own order: an
 * unauthenticated caller is indistinguishable from any other anonymous caller.
 * So a customer signs in anonymously, which costs no sign-up and no prompt, and
 * the uid goes on the order document. The rule then reads
 * `resource.data.customerUid == request.auth.uid`, which means a customer can
 * read exactly the orders they placed and no one else's — which is the property
 * the rule was always supposed to have.
 *
 * The uid is persisted to localStorage purely so a page reload does not mint a
 * new identity and orphan the order being tracked.
 */
async function customerUid(): Promise<string> {
  const KEY = "toe.customerUid";
  const { auth } = await getBundle();
  if (auth.currentUser) return auth.currentUser.uid;
  const { signInAnonymously } = await import("firebase/auth");
  const cred = await signInAnonymously(auth);
  try {
    localStorage.setItem(KEY, cred.user.uid);
  } catch {
    /* private mode: the session cookie still keeps this tab working */
  }
  return cred.user.uid;
}

/**
 * Tells a throttled order apart from any other refusal.
 *
 * Firestore reports both as a bare "permission-denied", and the phone's own note
 * of its last order (src/lib/order-throttle.ts) can be missing — cleared
 * storage, a second tab, a clock that disagrees with the server's. So on a
 * refusal, read this customer's own throttle document and, if it was stamped
 * within the gap, say so. One read, only on the failure path.
 */
async function asThrottled(
  err: unknown,
  uid: string,
): Promise<OrderThrottled | null> {
  if ((err as { code?: string })?.code !== "permission-denied") return null;
  try {
    const { db, fs } = await dbAndFs();
    const snap = await fs.getDoc(fs.doc(db, THROTTLE, uid));
    const last = snap.data()?.lastOrderAt as
      { toMillis?: () => number } | undefined;
    const at = typeof last?.toMillis === "function" ? last.toMillis() : null;
    // Handles a phone clock that disagrees with the server's: see the
    // function for how.
    const verdict = throttleFromServerStamp(at, Date.now());
    return verdict ? new OrderThrottled(verdict.seconds) : null;
  } catch {
    return null;
  }
}

/**
 * Bridges the async module load to the synchronous `Unsubscribe` contract: if
 * the component unmounts before the SDK finishes loading, the listener is torn
 * down as soon as it exists.
 */
function deferred(factory: () => Promise<Unsubscribe>): Unsubscribe {
  let off: Unsubscribe | null = null;
  let cancelled = false;

  void factory().then((fn) => {
    if (cancelled) fn();
    else off = fn;
  });

  return () => {
    cancelled = true;
    off?.();
    off = null;
  };
}

function menuDoc(item: MenuItem) {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    category: item.category,
    available: item.available,
    art: item.art ?? null,
    sortOrder: item.sortOrder,
  };
}

function sortItems(items: MenuItem[]): MenuItem[] {
  return items.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

function readOrder(snap: DocSnap): Order | null {
  const data = snap.data();
  if (!data) return null;
  const millis = (v: unknown) =>
    typeof (v as { toMillis?: () => number })?.toMillis === "function"
      ? (v as { toMillis: () => number }).toMillis()
      : typeof v === "number"
        ? v
        : undefined;
  return parseOrder({
    ...data,
    id: snap.id,
    createdAt: millis(data.createdAt) ?? Date.now(),
    completedAt: millis(data.completedAt),
  });
}

// --- menu -------------------------------------------------------------------

export const firestoreMenuRepo: MenuRepository = {
  subscribe(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.collection(db, MENU),
        (snap) => {
          const items = snap.docs
            .map((doc) => parseMenuItem({ id: doc.id, ...doc.data() }))
            .filter((item): item is MenuItem => item !== null);
          listener(sortItems(items));
        },
        (error) => onError?.(error),
      );
    });
  },
  async list() {
    const { db, fs } = await dbAndFs();
    const snap = await fs.getDocs(fs.collection(db, MENU));
    return sortItems(
      snap.docs
        .map((doc) => parseMenuItem({ id: doc.id, ...doc.data() }))
        .filter((item): item is MenuItem => item !== null),
    );
  },

  async create(input: MenuWriteInput): Promise<MenuItem> {
    const { db, fs } = await dbAndFs();
    const ref = fs.doc(fs.collection(db, MENU));
    const item: MenuItem = {
      id: ref.id,
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      category: input.category,
      available: input.available ?? true,
      art: input.art,
      sortOrder: 900_000 + (Date.now() % 100_000),
    };
    await fs.setDoc(ref, menuDoc(item));
    return item;
  },

  async update(id, patch) {
    const { db, fs } = await dbAndFs();
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await fs.updateDoc(fs.doc(db, MENU, id), clean);
  },

  async remove(id) {
    const { db, fs } = await dbAndFs();
    await fs.deleteDoc(fs.doc(db, MENU, id));
  },

  async reorder(items) {
    const { db, fs } = await dbAndFs();
    const batch = fs.writeBatch(db);
    items.forEach((item, index) => {
      batch.update(fs.doc(db, MENU, item.id), { sortOrder: (index + 1) * 10 });
    });
    await batch.commit();
  },

  async replaceAll(items) {
    const { db, fs } = await dbAndFs();
    const batch = fs.writeBatch(db);
    for (const item of items)
      batch.set(fs.doc(db, MENU, item.id), menuDoc(item));
    await batch.commit();
  },
};

// --- orders -----------------------------------------------------------------

export const firestoreOrderRepo: OrderRepository = {
  subscribeActive(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      // One bounded listener, oldest-first: the most urgent order stays on top and
      // the query stays index-friendly (§5.3).
      //
      // `in` rather than `status != "completed"`. Firestore treats a `!=` filter
      // as an inequality on a second field alongside the `orderBy`, and refuses
      // the query with "range and inequality filters on multiple fields" — a
      // failed-precondition, not a permissions error, so it surfaces as the board
      // silently dropping its listener. `in` is an equality match, so the single
      // (status, createdAt) composite index covers it. The list of open statuses
      // is the same constant the UI already uses, so it cannot drift.
      const query = fs.query(
        fs.collection(db, ORDERS),
        fs.where("status", "in", [...ACTIVE_STATUSES]),
        fs.orderBy("createdAt", "asc"),
        fs.limit(100),
      );
      return fs.onSnapshot(
        query,
        (snap) =>
          listener(
            snap.docs.map(readOrder).filter((o): o is Order => o !== null),
          ),
        (error) => onError?.(error),
      );
    });
  },

  subscribeOrder(id, listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.doc(db, ORDERS, id),
        (snap) => listener(snap.exists() ? readOrder(snap) : null),
        (error) => onError?.(error),
      );
    });
  },

  async create(input: NewOrderInput): Promise<Order> {
    const { db, fs } = await dbAndFs();
    const uid = await customerUid();
    const ref = fs.doc(fs.collection(db, ORDERS));
    const total = orderTotal(input.items);
    // `preparing` only when the phone found the table open; the rules check
    // that again (src/lib/table-open.ts). `pending` is always accepted.
    const status = input.status ?? "pending";
    // No number is written here. It used to be allocated from a shared
    // /meta/counters document in a transaction, which meant that document had to
    // be writable by the public (issue #30). Today's number (#0001…) is written
    // later by the staff board — see assignDayNumber below.
    //
    // The order and this customer's throttle document go in one batch (issue
    // #32). The rules refuse an order unless the same commit stamps
    // /orderThrottle/{uid} with this order's id at request.time, and refuse that
    // stamp unless ORDER_GAP_SECONDS have passed since the previous one. Both
    // serverTimestamp()s resolve to the commit time, which is request.time.
    // A blind set, not a read-then-write: nothing needs reading first.
    const batch = fs.writeBatch(db);
    batch.set(ref, {
      tableNumber: input.tableNumber,
      items: input.items,
      total,
      status,
      createdAt: fs.serverTimestamp(),
      notes: input.notes ?? "",
      paymentMethod: input.paymentMethod ?? "counter",
      customerUid: uid,
      // Only when there is one. The rules check it against tableKeys/{table},
      // and a table with no code yet must keep taking orders without it. It
      // stays on the order document afterwards, where staff can read it; see
      // docs/decisions.md for why that is acceptable.
      ...(input.tableKey ? { tableKey: input.tableKey } : {}),
    });
    batch.set(fs.doc(db, THROTTLE, uid), {
      lastOrderAt: fs.serverTimestamp(),
      lastOrderId: ref.id,
    });
    try {
      await batch.commit();
    } catch (err) {
      throw (await asThrottled(err, uid)) ?? err;
    }

    return parseOrder({
      id: ref.id,
      tableNumber: input.tableNumber,
      items: input.items,
      total,
      status,
      createdAt: Date.now(),
      paymentMethod: input.paymentMethod ?? "counter",
    }) as Order;
  },

  async setStatus(id, status, keepTableOpen) {
    const { db, fs } = await dbAndFs();
    const patch: Record<string, unknown> = { status };
    if (status === "completed") patch.completedAt = fs.serverTimestamp();
    if (!keepTableOpen) {
      await fs.updateDoc(fs.doc(db, ORDERS, id), patch);
      return;
    }
    // One commit, so the table's time and the order move together.
    const batch = fs.writeBatch(db);
    batch.update(fs.doc(db, ORDERS, id), patch);
    batch.set(fs.doc(db, SESSIONS, String(keepTableOpen.table)), {
      openUntil: fs.Timestamp.fromMillis(keepTableOpen.openUntil),
    });
    await batch.commit();
  },

  async accept(ids, table, openUntil) {
    const { db, fs } = await dbAndFs();
    // The orders and the table in one commit: an accepted order on a table
    // that failed to open would make the group's next order wait again.
    const batch = fs.writeBatch(db);
    for (const id of ids) {
      batch.update(fs.doc(db, ORDERS, id), { status: "preparing" });
    }
    batch.set(fs.doc(db, SESSIONS, String(table)), {
      openUntil: fs.Timestamp.fromMillis(openUntil),
    });
    await batch.commit();
  },

  async reject(id, reason) {
    const { db, fs } = await dbAndFs();
    const clean = reason?.trim().slice(0, MAX_REJECT_REASON);
    await fs.updateDoc(fs.doc(db, ORDERS, id), {
      status: "rejected",
      ...(clean ? { rejectReason: clean } : {}),
    });
  },

  async assignDayNumber(id) {
    const { db, fs } = await dbAndFs();
    const orderRef = fs.doc(db, ORDERS, id);
    // runTransaction retries on contention. When two boards race for the same
    // order, the loser's retry re-reads it, finds the winner's number, and
    // returns null without writing. The rules check the number against the
    // counter in this same commit, so nothing else can slip through.
    const attempt = () =>
      fs.runTransaction(db, (tx) =>
        assignInTransaction(
          {
            async readOrder() {
              const snap = await tx.get(orderRef);
              const order = snap.exists() ? readOrder(snap) : null;
              if (!order) return null;
              // The raw field, not the parsed one: a malformed number still
              // counts as "has one", and the rules would refuse a second anyway.
              const raw = snap.data()?.dayNumber;
              return {
                createdAt: order.createdAt,
                dayNumber: raw ?? undefined,
                status: order.status,
              };
            },
            async readCounter(dayKey) {
              const snap = await tx.get(fs.doc(db, DAY_COUNTERS, dayKey));
              return snap.exists() ? counterNext(snap.data()) : null;
            },
            write({ dayKey, dayNumber }) {
              tx.update(orderRef, { dayNumber, dayKey });
              // A whole-document set covers both "first order of the day" and
              // every one after it. `last` names the order this bump is for:
              // the rules refuse a bump that numbers no order, or two.
              tx.set(fs.doc(db, DAY_COUNTERS, dayKey), {
                next: dayNumber + 1,
                last: id,
              });
            },
          },
          id,
        ),
      );
    try {
      return await attempt();
    } catch (err) {
      // The board that loses a race is not always retried: its commit can be
      // judged by the rules against the winner's, which it no longer matches,
      // and come back permission-denied. So on a refusal, look again: if the
      // order has a number now, somebody else numbered it, which is fine.
      if ((err as { code?: string })?.code === "permission-denied") {
        const now = await fs.getDoc(orderRef).catch(() => null);
        if (now?.data()?.dayNumber !== undefined) return null;
      }
      throw err;
    }
  },

  async listRange(fromMs, toMs, limit) {
    const { db, fs } = await dbAndFs();
    const bounds = [
      fs.where("createdAt", ">=", fs.Timestamp.fromDate(new Date(fromMs))),
      fs.where("createdAt", "<", fs.Timestamp.fromDate(new Date(toMs))),
    ];
    // With a limit, read newest-first so the cap drops the oldest orders, not
    // today's. Both directions are served by the automatic single-field index
    // on createdAt, so no composite index is needed either way.
    const query =
      limit === undefined
        ? fs.query(
            fs.collection(db, ORDERS),
            ...bounds,
            fs.orderBy("createdAt", "asc"),
          )
        : fs.query(
            fs.collection(db, ORDERS),
            ...bounds,
            fs.orderBy("createdAt", "desc"),
            fs.limit(limit),
          );
    const snap = await fs.getDocs(query);
    const orders = snap.docs
      .map(readOrder)
      .filter((o): o is Order => o !== null);
    return limit === undefined ? orders : orders.reverse();
  },
};

// --- config -----------------------------------------------------------------

export const firestoreConfigRepo: ConfigRepository = {
  subscribe(listener: Listener<SpecialOffer>) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.doc(db, CONFIG, SPECIAL_DOC),
        (snap) => listener(parseSpecialOffer(snap.data())),
        () => listener({ enabled: false, text: "" }),
      );
    });
  },
  async save(offer: SpecialOffer) {
    const { db, fs } = await dbAndFs();
    await fs.setDoc(
      fs.doc(db, CONFIG, SPECIAL_DOC),
      { enabled: offer.enabled, text: offer.text.trim().slice(0, 140) },
      { merge: true },
    );
  },
  subscribeTables(listener) {
    return deferred(async () => {
      let loaded: Awaited<ReturnType<typeof dbAndFs>>;
      try {
        loaded = await dbAndFs();
      } catch {
        // /order waits on this list before it trusts a scanned table, so a
        // failed SDK download must still answer, or the customer never leaves
        // the loader.
        listener(null);
        return () => {};
      }
      const { db, fs } = loaded;
      return fs.onSnapshot(
        fs.doc(db, CONFIG, TABLES_DOC),
        (snap) => listener(normalizeTables(snap.data()?.tables)),
        // The document is public-read, so a failure here is the network, not
        // the rules. Falling back to the default keeps the picker usable
        // rather than leaving the customer on a loader.
        () => listener(null),
      );
    });
  },
  async saveTables(tables) {
    const { db, fs } = await dbAndFs();
    // A whole-document set, not a merge: the rules allow `tables` and nothing
    // else on this document.
    await fs.setDoc(fs.doc(db, CONFIG, TABLES_DOC), {
      tables: checkTablesForSave(tables),
    });
  },
  subscribeTableKeys(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.collection(db, TABLE_KEYS),
        (snap) => {
          const keys: Record<number, string> = {};
          for (const d of snap.docs) {
            const n = Number(d.id);
            const key = d.data().key;
            if (Number.isInteger(n) && isTableKey(key)) keys[n] = key;
          }
          listener(keys);
        },
        (error) => onError?.(error),
      );
    });
  },
  async saveTableKeys(keys) {
    const { db, fs } = await dbAndFs();
    // One batch, so "Create codes for all tables" either gives every table a
    // code or none — never a half-coded cafe from a dropped connection.
    const batch = fs.writeBatch(db);
    for (const [table, key] of Object.entries(keys)) {
      batch.set(fs.doc(db, TABLE_KEYS, String(table)), { key });
    }
    await batch.commit();
  },
};

// --- open tables -----------------------------------------------------------

export const firestoreSessionRepo: SessionRepository = {
  subscribe(listener, onError) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      // At most one small document per table, so the whole collection is a
      // cheap listener.
      return fs.onSnapshot(
        fs.collection(db, SESSIONS),
        (snap) => {
          const sessions: TableSessions = {};
          for (const d of snap.docs) {
            const entry = parseTableSessionsDoc(d.id, d.data());
            if (entry) sessions[entry[0]] = entry[1];
          }
          listener(sessions);
        },
        (error) => onError?.(error),
      );
    });
  },
  async isOpen(table) {
    const { db, fs } = await dbAndFs();
    const snap = await fs.getDoc(fs.doc(db, SESSIONS, String(table)));
    const entry = parseTableSessionsDoc(table, snap.data());
    // The phone's clock against the server's time: lean towards "open" and
    // let the rules decide (see looksOpen).
    return entry !== null && looksOpen(entry[1], Date.now());
  },
  async close(table) {
    const { db, fs } = await dbAndFs();
    // The server's own clock, so a tablet with a wrong one still closes it.
    await fs.setDoc(fs.doc(db, SESSIONS, String(table)), {
      openUntil: fs.serverTimestamp(),
    });
  },
  subscribeSettings(listener) {
    return deferred(async () => {
      const { db, fs } = await dbAndFs();
      return fs.onSnapshot(
        fs.doc(db, CONFIG, ORDERING_DOC),
        (snap) => listener(parseOrderingSettings(snap.data())),
        () => listener(parseOrderingSettings(undefined)),
      );
    });
  },
  async readSettings() {
    const { db, fs } = await dbAndFs();
    const snap = await fs.getDoc(fs.doc(db, CONFIG, ORDERING_DOC));
    return parseOrderingSettings(snap.data());
  },
  async saveSettings(settings) {
    const { db, fs } = await dbAndFs();
    // Whole document: the rules allow this one field and nothing else.
    await fs.setDoc(fs.doc(db, CONFIG, ORDERING_DOC), {
      confirmNewGuests: settings.confirmNewGuests,
    });
  },
};

// --- auth -------------------------------------------------------------------

const ROLE_CACHE_KEY = "cafe-qr-order.roles.v1";

/** The last role seen for this uid, so a reload offline still opens the board. */
function readCachedRole(uid: string): StaffRole | null {
  try {
    const raw = globalThis.localStorage?.getItem(ROLE_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const role = map[uid];
    return role === "owner" || role === "staff" || role === "unassigned"
      ? role
      : null;
  } catch {
    return null;
  }
}

function cacheRole(uid: string, role: StaffRole) {
  try {
    const raw = globalThis.localStorage?.getItem(ROLE_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[uid] = role;
    globalThis.localStorage?.setItem(ROLE_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* best-effort cache only */
  }
}

export const firestoreAuthRepo: AuthRepository = {
  async signIn(email, password) {
    const { auth } = await getBundle();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    // The role is not looked up here. `subscribe` below reads /staff/{uid} on
    // every auth change — including this one — so one place decides it, and it
    // also runs on a plain page reload, not only on sign-in. (This used to fetch
    // the role itself and default a missing document to "staff", which the
    // rules stopped honouring when membership became explicit.)
    await signInWithEmailAndPassword(auth, email.trim(), password);
  },

  async signInWithPin(pin) {
    if (pin !== getDemoStaffPin()) {
      throw new Error("Wrong PIN. Ask the counter for today's code.");
    }
    throw new Error(
      "PIN sign-in is a demo-only shortcut. Use your staff email and password.",
    );
  },

  async signOut() {
    const { auth } = await getBundle();
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
  },

  subscribe(listener) {
    let off: Unsubscribe = () => {};
    let cancelled = false;
    // Bumped on every auth change, so a slow role lookup for a previous user
    // can never overwrite the current one.
    let generation = 0;

    void (async () => {
      const { auth, db, fs } = await getBundle();
      const { onAuthStateChanged } = await import("firebase/auth");
      if (cancelled) return;
      off = onAuthStateChanged(auth, (user) => {
        const mine = ++generation;
        const live = () => !cancelled && mine === generation;

        // A customer's anonymous session is not a staff session. Without this,
        // a phone that placed an order and then opened /staff was treated as a
        // signed-in barista instead of being shown the sign-in form.
        if (!user || user.isAnonymous) {
          listener(null);
          return;
        }

        const base = { uid: user.uid, email: user.email ?? "" };
        const fallbackName =
          user.displayName ?? user.email?.split("@")[0] ?? "Staff";

        // Paint straight away from the cached role, if there is one, so the
        // counter phone does not flash a sign-in form on every reload.
        const cached = readCachedRole(user.uid);
        if (cached)
          listener({ ...base, role: cached, displayName: fallbackName });

        // Then ask Firestore. The rules let a signed-in user read their own
        // /staff document, and only that one, so this works for an account
        // that has not been set up yet: it simply comes back missing.
        fs.getDoc(fs.doc(db, STAFF, user.uid))
          .then((snap) => {
            if (!live()) return;
            const data = snap.exists() ? snap.data() : undefined;
            const role = roleFromStaffDoc(snap.exists(), data);
            cacheRole(user.uid, role);
            listener({
              ...base,
              role,
              displayName: staffDisplayName(data, user.email),
            });
          })
          .catch(() => {
            // Offline, most likely. Keep the cached role if we painted one;
            // otherwise assume staff and let the board's own error banner say
            // what went wrong. Guessing "unassigned" here would tell a real
            // barista their account does not exist because the wifi dropped.
            if (!live() || cached) return;
            listener({ ...base, role: "staff", displayName: fallbackName });
          });
      });
    })();

    return () => {
      cancelled = true;
      off();
    };
  },

  current() {
    // The auth state is owned by onAuthStateChanged; the synchronous getter is
    // only a best-effort read used before the first listener resolves.
    return null;
  },
};

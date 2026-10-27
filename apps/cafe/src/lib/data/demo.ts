/**
 * Demo-mode implementation of the storage contracts.
 *
 * Note the shape: every `subscribe*` returns an unsubscribe and fires
 * synchronously with the current value, so a React consumer can `useSyncExternalStore`
 * on it without a loading flash.
 */

import { getDemoStaffPin } from "../config";
import { checkTablesForSave } from "../tables";
import { cleanStaffName, generateInviteId } from "../invites";
import type { MenuItem, Order, SpecialOffer, Unsubscribe } from "../types";
import * as store from "./demo-store";
import { DEMO_CREDENTIALS, DEMO_OWNER_USER, DEMO_STAFF_USER } from "./seed";
import type {
  AuthRepository,
  ConfigRepository,
  MenuRepository,
  MenuWriteInput,
  NewOrderInput,
  OrderRepository,
  SessionRepository,
  StaffRepository,
  StaffUser,
} from "./types";
import { looksOpen } from "../table-open";
import { t } from "../i18n";

const SESSION_KEY = "cafe-qr-order.session.v1";

/**
 * Who is signed in, with the role and name their /staff record gives them
 * now, as Firestore's auth repository reads it: no record is `unassigned`.
 * Live, so an owner removing someone or changing a role in another tab
 * reaches that person's board straight away.
 */
function readSession(): StaffUser | null {
  const user = readStoredSession();
  if (!user) return null;
  const record = store.loadDemoState().staff[user.uid];
  return record
    ? { ...user, role: record.role, displayName: record.name }
    : { ...user, role: "unassigned" };
}

/** The signed-in account itself, as Firebase Auth would hold it. */
function readStoredSession(): StaffUser | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const user = parsed as Partial<StaffUser>;
    if (typeof user.uid !== "string" || typeof user.role !== "string")
      return null;
    return {
      uid: user.uid,
      email: typeof user.email === "string" ? user.email : "",
      role: user.role === "owner" ? "owner" : "staff",
      displayName:
        typeof user.displayName === "string"
          ? user.displayName
          : t("roles.staff"),
    };
  } catch {
    return null;
  }
}

function writeSession(user: StaffUser | null) {
  try {
    if (user)
      globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(user));
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: session simply won't survive a reload */
  }
}

const sessionListeners = new Set<() => void>();

function emitSession() {
  for (const listener of sessionListeners) listener();
}

/** Firebase Auth's errors carry a code; friendly-errors.ts reads it. */
function authError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function isDemoEmail(email: string): boolean {
  return (
    email === DEMO_CREDENTIALS.staff.email ||
    email === DEMO_CREDENTIALS.owner.email
  );
}

export const demoMenuRepo: MenuRepository = {
  subscribe(listener, onError) {
    try {
      return store.subscribeState((state) => listener(store.selectMenu(state)));
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return () => {};
    }
  },

  async list() {
    return store.selectMenu(store.loadDemoState());
  },

  async create(input: MenuWriteInput): Promise<MenuItem> {
    return store.demoCreateMenu({
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      category: input.category,
      available: input.available ?? true,
      art: input.art,
    });
  },

  async update(id, patch) {
    store.demoWriteMenu(id, patch);
  },

  async remove(id) {
    store.demoDeleteMenu(id);
  },

  async reorder(items) {
    store.demoReplaceMenu(
      items.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 })),
    );
  },

  async replaceAll(items) {
    store.demoReplaceMenu(items);
  },

  async importItems(items, replace = false) {
    store.demoImportMenu(
      items.map((input) => ({
        name: input.name,
        description: input.description ?? "",
        price: input.price,
        category: input.category,
        available: input.available ?? true,
        art: input.art,
      })),
      replace,
    );
  },
};

export const demoOrderRepo: OrderRepository = {
  subscribeActive(listener, onError) {
    try {
      return store.subscribeState((state) =>
        listener(store.selectActiveOrders(state)),
      );
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return () => {};
    }
  },

  subscribeOrder(id, listener, onError) {
    try {
      return store.subscribeState((state) =>
        listener(store.selectOrder(state, id)),
      );
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return () => {};
    }
  },

  async create(input: NewOrderInput): Promise<Order> {
    return store.demoCreateOrder(input);
  },

  async setStatus(id, status, keepTableOpen) {
    if (keepTableOpen) requireStaff();
    store.demoSetStatus(id, status, keepTableOpen);
  },

  async accept(ids, _table, openUntil) {
    requireStaff();
    store.demoAcceptOrders(ids, openUntil);
  },

  async reject(id, reason) {
    store.demoRejectOrder(id, reason);
  },

  // Staff and owner only, as in firestore.rules (/dayCounters).
  async assignDayNumber(id, timeZone) {
    const role = readSession()?.role;
    if (role !== "staff" && role !== "owner") {
      throw new store.DemoRulesRefusal("only staff number orders");
    }
    return store.demoAssignDayNumber(id, timeZone);
  },

  async listRange(fromMs, toMs, limit) {
    const all = store.selectOrdersInRange(store.loadDemoState(), fromMs, toMs);
    // Same contract as Firestore: the newest `limit`, still oldest first
    return limit !== undefined && all.length > limit
      ? all.slice(all.length - limit)
      : all;
  },
};

export const demoAuthRepo: AuthRepository = {
  async signIn(email, password) {
    const match =
      (email.trim().toLowerCase() === DEMO_CREDENTIALS.staff.email &&
        password === DEMO_CREDENTIALS.staff.password) ||
      (email.trim().toLowerCase() === DEMO_CREDENTIALS.owner.email &&
        password === DEMO_CREDENTIALS.owner.password);

    // Someone who joined with an invite in this browser.
    const typed = email.trim().toLowerCase();
    const joined = store.selectAccount(store.loadDemoState(), typed);
    if (!match && joined?.password === password) {
      writeSession({
        uid: joined.uid,
        email: typed,
        role: "staff",
        displayName: typed.split("@")[0],
      });
      emitSession();
      return;
    }

    if (!match) {
      throw new Error(t("errors.demoMismatch"));
    }
    const isOwner = email.trim().toLowerCase() === DEMO_CREDENTIALS.owner.email;
    writeSession(isOwner ? { ...DEMO_OWNER_USER } : { ...DEMO_STAFF_USER });
    emitSession();
  },

  async signUp(email, password) {
    const typed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
      throw authError("auth/invalid-email", t("errors.demoNotEmail"));
    }
    if (password.length < 6) {
      throw authError("auth/weak-password", t("errors.demoShortPassword"));
    }
    if (
      isDemoEmail(typed) ||
      store.selectAccount(store.loadDemoState(), typed)
    ) {
      throw authError("auth/email-already-in-use", t("errors.demoEmailTaken"));
    }
    const uid = store.makeId("demo-user");
    store.demoAddAccount(typed, { uid, password });
    writeSession({
      uid,
      email: typed,
      role: "staff",
      displayName: typed.split("@")[0],
    });
    emitSession();
  },

  async signInWithPin(pin) {
    if (pin !== getDemoStaffPin()) {
      throw new Error(t("errors.wrongPin"));
    }
    writeSession({ ...DEMO_STAFF_USER });
    emitSession();
  },

  async signOut() {
    writeSession(null);
    emitSession();
  },

  subscribe(listener): Unsubscribe {
    // On sign-in and sign-out, and on any store change that moves this
    // person's role (readSession), but only when something did change: the
    // store changes on every order.
    let last: string | undefined;
    const emit = () => {
      const user = readSession();
      const key = JSON.stringify(user);
      if (key === last) return;
      last = key;
      listener(user);
    };
    sessionListeners.add(emit);
    const off = store.subscribeState(emit);
    return () => {
      sessionListeners.delete(emit);
      off();
    };
  },

  current() {
    return readSession();
  },
};

/** The rules' isStaff(): the owner counts, a customer's phone does not. */
function requireStaff() {
  const role = readSession()?.role;
  if (role !== "staff" && role !== "owner") {
    throw new store.DemoRulesRefusal("only staff open and close tables");
  }
}

export const demoSessionRepo: SessionRepository = {
  subscribe(listener) {
    return store.subscribeState((state) =>
      listener(store.selectTableSessions(state)),
    );
  },
  async isOpen(table) {
    // Same lean towards "open" as Firestore's; the store's own check (the
    // rules' stand-in) uses the exact time.
    return looksOpen(
      store.selectTableSessions(store.loadDemoState())[table],
      Date.now(),
    );
  },
  async close(table) {
    requireStaff();
    store.demoCloseTable(table);
  },
  subscribeSettings(listener) {
    return store.subscribeState((state) =>
      listener(store.selectOrdering(state)),
    );
  },
  async readSettings() {
    return store.selectOrdering(store.loadDemoState());
  },
  async saveSettings(settings) {
    if (readSession()?.role !== "owner") {
      throw new store.DemoRulesRefusal("only the owner changes this");
    }
    store.demoSaveOrdering(settings);
  },
};

export const demoConfigRepo: ConfigRepository = {
  subscribe(listener) {
    return store.subscribeState((state) => listener(store.selectOffer(state)));
  },
  async save(offer: SpecialOffer) {
    store.demoSaveOffer({
      enabled: offer.enabled,
      text: offer.text.trim().slice(0, 140),
    });
  },
  subscribeSite(listener) {
    return store.subscribeState((state) => listener(store.selectSite(state)));
  },
  subscribeOwnerMaintenance(listener) {
    return store.subscribeState((state) =>
      listener(store.selectOwnerMaintenance(state)),
    );
  },
  async saveOwnerMaintenance(record) {
    if (readSession()?.role !== "owner") {
      throw new store.DemoRulesRefusal("only the owner changes this");
    }
    store.demoSaveOwnerMaintenance(record ? { ...record } : null);
  },
  subscribeTables(listener) {
    return store.subscribeState((state) => listener(store.selectTables(state)));
  },
  async saveTables(tables) {
    store.demoSaveTables(checkTablesForSave(tables));
  },
  // Owner-only, as the rules make it: a barista's board has no business
  // holding the codes that let an order in.
  subscribeTableKeys(listener, onError) {
    if (readSession()?.role !== "owner") {
      onError?.(new store.DemoRulesRefusal("table codes are owner-only"));
      return () => {};
    }
    return store.subscribeState((state) =>
      listener(store.selectTableKeys(state)),
    );
  },
  async saveTableKeys(keys) {
    if (readSession()?.role !== "owner") {
      throw new store.DemoRulesRefusal("table codes are owner-only");
    }
    store.demoSaveTableKeys(keys);
  },
};

function requireOwner() {
  if (readSession()?.role !== "owner") {
    throw new store.DemoRulesRefusal("only the owner manages the team");
  }
}

export const demoStaffRepo: StaffRepository = {
  subscribe(listener, onError) {
    if (readSession()?.role !== "owner") {
      onError?.(new store.DemoRulesRefusal("the staff list is owner-only"));
      return () => {};
    }
    return store.subscribeState((state) => listener(store.selectStaff(state)));
  },
  subscribeInvites(listener, onError) {
    if (readSession()?.role !== "owner") {
      onError?.(new store.DemoRulesRefusal("invites are owner-only"));
      return () => {};
    }
    return store.subscribeState((state) =>
      listener(store.selectInvites(state)),
    );
  },
  async createInvite(role) {
    requireOwner();
    const invite = {
      id: generateInviteId(),
      role,
      createdAt: Date.now(),
      usedBy: null,
    };
    store.demoSaveInvite(invite);
    return invite;
  },
  async deleteInvite(id) {
    requireOwner();
    store.demoDeleteInvite(id);
  },
  async setRole(uid, role) {
    requireOwner();
    store.demoSetStaffRole(uid, role);
  },
  async remove(uid) {
    requireOwner();
    store.demoRemoveStaff(uid);
  },
  async readInvite(id) {
    return (
      store.selectInvites(store.loadDemoState()).find((i) => i.id === id) ??
      null
    );
  },
  async join(id, name) {
    const user = readStoredSession();
    if (!user?.email) throw new Error(t("errors.signInFirst"));
    return store.demoJoin(user, id, cleanStaffName(name));
  },
};

/**
 * Demo-mode implementation of the storage contracts.
 *
 * Note the shape: every `subscribe*` returns an unsubscribe and fires
 * synchronously with the current value, so a React consumer can `useSyncExternalStore`
 * on it without a loading flash.
 */

import { getDemoStaffPin } from "../config";
import { checkTablesForSave } from "../tables";
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
  StaffUser,
} from "./types";
import { looksOpen } from "../table-open";

const SESSION_KEY = "cafe-qr-order.session.v1";

function readSession(): StaffUser | null {
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
        typeof user.displayName === "string" ? user.displayName : "Staff",
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

const sessionListeners = new Set<(user: StaffUser | null) => void>();

function emitSession() {
  const user = readSession();
  for (const listener of sessionListeners) listener(user);
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
  async assignDayNumber(id) {
    const role = readSession()?.role;
    if (role !== "staff" && role !== "owner") {
      throw new store.DemoRulesRefusal("only staff number orders");
    }
    return store.demoAssignDayNumber(id);
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

    if (!match) {
      throw new Error("That email and password do not match.");
    }
    const isOwner = email.trim().toLowerCase() === DEMO_CREDENTIALS.owner.email;
    writeSession(isOwner ? { ...DEMO_OWNER_USER } : { ...DEMO_STAFF_USER });
    emitSession();
  },

  async signInWithPin(pin) {
    if (pin !== getDemoStaffPin()) {
      throw new Error("Wrong PIN. Ask the counter for today's code.");
    }
    writeSession({ ...DEMO_STAFF_USER });
    emitSession();
  },

  async signOut() {
    writeSession(null);
    emitSession();
  },

  subscribe(listener): Unsubscribe {
    sessionListeners.add(listener);
    listener(readSession());
    return () => {
      sessionListeners.delete(listener);
    };
  },

  current() {
    return readSession();
  },
};

/** The rules' isStaff(): the owner counts, a customer's phone does not. */
function requireStaff() {
  if (!readSession()) {
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
    store.demoSetTableOpenUntil(table, Date.now());
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

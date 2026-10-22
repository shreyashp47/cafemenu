"use client";

/**
 * Storage context + subscription hooks.
 *
 * Every read in the app goes through here, which means:
 *  - switching backends is a one-line change in /lib/data
 *  - components never import the SDK directly
 *  - `useSyncExternalStore` gives tear-free live updates for free
 *
 * Which backend is decided when the page loads (src/lib/boot.ts), not at build
 * time. Until it is, every repository hook returns null, which the screens
 * already show as loading. A real cafe that cannot reach its config gets
 * <CafeUnreachable> and a retry, never the demo store.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { CafeUnreachable } from "@/components/CafeUnreachable";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import {
  boot,
  peekBoot,
  readDeviceConfig,
  retryBoot,
  type Boot,
} from "@/lib/boot";
import {
  demoBundle,
  loadBundle,
  preloadFirestore,
  type DataBundle,
} from "@/lib/data";
import { setLiveSettings } from "@/lib/settings";
import type {
  AuthRepository,
  ConfigRepository,
  MenuRepository,
  OrderRepository,
  SessionRepository,
  StaffRepository,
  StaffUser,
} from "@/lib/data/types";
import type { Invite, StaffMember } from "@/lib/invites";
import type { TableKeys } from "@/lib/table-keys";
import {
  DEFAULT_ORDERING,
  type OrderingSettings,
  type TableSessions,
} from "@/lib/table-open";
import type { MenuItem, Order, SpecialOffer } from "@/lib/types";

interface DataContextValue {
  /** null until the page has booted and its backend has loaded. */
  bundle: DataBundle | null;
}

const DataContext = createContext<DataContextValue>({ bundle: null });

/**
 * Where the page is on its way to a backend: still booting (src/lib/boot.ts)
 * or loading the SDK, ready, or stuck, with the reason for the retry screen.
 */
type DataState =
  | { status: "loading" }
  | { status: "ready"; bundle: DataBundle }
  | { status: "unreachable"; reason: "offline" | "no-config" };

/** What can be shown without waiting: only demo mode, or a known dead end. */
function stateFor(started: Boot | null): DataState {
  switch (started?.backend.kind) {
    case "demo":
      return { status: "ready", bundle: demoBundle };
    case "unreachable":
      return { status: "unreachable", reason: started.backend.reason };
    default:
      return { status: "loading" };
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  // A page opened after the boot settled (a client-side navigation, or every
  // unit test, which primes it) starts in its final state, with no loader.
  const [state, setState] = useState<DataState>(() => stateFor(peekBoot()));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    // A device that kept a Firebase config last time is a real cafe's: fetch
    // the SDK while init.json is still on its way.
    if (attempt === 0 && !peekBoot() && readDeviceConfig()) preloadFirestore();

    void (async () => {
      const started = attempt === 0 ? await boot() : await retryBoot();
      if (!alive) return;
      if (started.backend.kind !== "firebase") {
        const next = stateFor(started);
        setState((prev) =>
          prev.status === next.status &&
          (prev.status !== "ready" ||
            (next.status === "ready" && prev.bundle === next.bundle))
            ? prev
            : next,
        );
        return;
      }
      try {
        const bundle = await loadBundle();
        if (alive) setState({ status: "ready", bundle });
      } catch {
        // The SDK itself did not download: as good as offline.
        if (alive) setState({ status: "unreachable", reason: "offline" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  // Back online: try again without waiting for a tap.
  const unreachable = state.status === "unreachable";
  useEffect(() => {
    if (!unreachable) return;
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [unreachable, retry]);

  // The cafe's live settings (config/site) for the whole page.
  const bundle = state.status === "ready" ? state.bundle : null;
  useEffect(() => {
    if (!bundle) return;
    return bundle.config.subscribeSite(setLiveSettings);
  }, [bundle]);

  const value = useMemo<DataContextValue>(() => ({ bundle }), [bundle]);

  if (state.status === "unreachable") {
    return <CafeUnreachable reason={state.reason} onRetry={retry} />;
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function useData(): DataContextValue {
  return useContext(DataContext);
}

/** False until the backend is known, so no demo banner flashes on a real cafe. */
export function useIsDemo(): boolean {
  return useData().bundle?.isDemo ?? false;
}

export function useMenuRepo(): MenuRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.menu ?? null, [bundle]);
}

export function useOrderRepo(): OrderRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.orders ?? null, [bundle]);
}

export function useAuthRepo(): AuthRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.auth ?? null, [bundle]);
}

export function useConfigRepo(): ConfigRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.config ?? null, [bundle]);
}

export function useSessionRepo(): SessionRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.sessions ?? null, [bundle]);
}

export function useStaffRepo(): StaffRepository | null {
  const { bundle } = useData();
  return useMemo(() => bundle?.staff ?? null, [bundle]);
}

/** Generic live subscription bridged onto useSyncExternalStore. */
function useLive<T>(
  subscribe: ((listener: (value: T) => void) => () => void) | null,
  initial: T,
): { value: T; ready: boolean } {
  const cache = useRef<{ value: T }>({ value: initial });
  const listeners = useRef(new Set<() => void>());

  const subscribeFn = useCallback(
    (onStoreChange: () => void) => {
      if (!subscribe) return () => {};
      listeners.current.add(onStoreChange);
      return () => {
        listeners.current.delete(onStoreChange);
      };
    },
    [subscribe],
  );

  const getSnapshot = useCallback(() => cache.current.value, []);

  const value = useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!subscribe) return;
    let alive = true;
    const off = subscribe((next) => {
      if (!alive) return;
      cache.current = { value: next };
      listeners.current.forEach((l) => l());
    });
    return () => {
      alive = false;
      off();
    };
  }, [subscribe]);

  return { value, ready: Boolean(subscribe) };
}

// --- domain hooks -----------------------------------------------------------

export function useMenu(): {
  items: MenuItem[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useMenuRepo();
  const [error, setError] = useState<Error | null>(null);

  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (items: MenuItem[]) => void) =>
            repo.subscribe(listener, setError)
        : null,
    [repo],
  );

  const { value } = useLive<MenuItem[]>(subscribe, []);
  return { items: value, loading: !repo, error };
}

/**
 * `enabled` exists because the staff board used to subscribe before anyone had
 * signed in. The order rules only let a *staff* account list orders, so that
 * first listener was refused, the page showed "Live updates dropped: Missing or
 * insufficient permissions", and because the subscription is created once it was
 * never retried — the board stayed empty for a correctly signed-in barista. Every
 * network request afterwards succeeded; the page was showing a failure from
 * before the session existed.
 */
export function useActiveOrders(enabled = true): {
  orders: Order[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useOrderRepo();
  const [error, setError] = useState<Error | null>(null);

  const subscribe = useMemo(() => {
    if (!repo || !enabled) return null;
    return (listener: (orders: Order[]) => void) =>
      repo.subscribeActive((orders) => {
        // A good snapshot clears a bad one, so a single dropped connection does
        // not leave a permanent banner sitting above a working board.
        setError(null);
        listener(orders);
      }, setError);
  }, [repo, enabled]);

  const { value } = useLive<Order[]>(subscribe, []);
  return { orders: enabled ? value : [], loading: !repo || !enabled, error };
}

export function useOrder(id: string | null): {
  order: Order | null;
  loading: boolean;
} {
  const repo = useOrderRepo();

  const subscribe = useMemo(
    () =>
      repo && id
        ? (listener: (order: Order | null) => void) =>
            repo.subscribeOrder(id, listener)
        : null,
    [repo, id],
  );

  const { value } = useLive<Order | null>(subscribe, null);
  return { order: value, loading: !repo };
}

export function useSpecialOffer(): SpecialOffer {
  const repo = useConfigRepo();
  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (offer: SpecialOffer) => void) => repo.subscribe(listener)
        : null,
    [repo],
  );
  const { value } = useLive<SpecialOffer>(subscribe, {
    enabled: false,
    text: "",
  });
  return value;
}

/**
 * The cafe's tables: the owner's saved list, or the `tables` in the cafe's
 * settings until one is saved.
 *
 * Unlike the hooks above this reports `loading` until the first snapshot has
 * actually arrived, not merely until the repository exists. The customer's
 * table check depends on it: answering with the default while the saved list is
 * still in flight would bounce someone who scanned a perfectly good QR code for
 * table 9 to "that table number looks odd", just because 9 is not in 1..6.
 */
export function useTables(): {
  tables: number[];
  /** The saved list itself, `null` when the default is in use. */
  saved: number[] | null;
  loading: boolean;
} {
  const repo = useConfigRepo();
  // Tagged with the repo it came from, so a snapshot from a previous backend
  // (the demo bundle before Firebase loads) is never mistaken for this one's.
  const [snapshot, setSnapshot] = useState<{
    repo: ConfigRepository;
    saved: number[] | null;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    return repo.subscribeTables((saved) => setSnapshot({ repo, saved }));
  }, [repo]);

  const loaded = snapshot !== null && snapshot.repo === repo;
  const saved = loaded ? snapshot.saved : null;
  // Without a saved list the default comes from the settings, so they have to
  // be known too, for the same reason.
  const { settings, ready } = useCafeSettings();
  return {
    tables: saved ?? settings.tables,
    saved,
    loading: !loaded || (saved === null && !ready),
  };
}

/**
 * The owner's per-table QR codes, live. Owner-only: the rules refuse anyone
 * else, so only /admin/qr (behind the owner gate) calls this.
 */
export function useTableKeys(): {
  keys: TableKeys;
  loading: boolean;
  error: Error | null;
} {
  const repo = useConfigRepo();
  const [snapshot, setSnapshot] = useState<{
    repo: ConfigRepository;
    keys: TableKeys;
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    return repo.subscribeTableKeys(
      (keys) => setSnapshot({ repo, keys, error: null }),
      (error) => setSnapshot({ repo, keys: {}, error }),
    );
  }, [repo]);

  const loaded = snapshot !== null && snapshot.repo === repo;
  return {
    keys: loaded ? snapshot.keys : EMPTY_KEYS,
    loading: !loaded,
    error: loaded ? snapshot.error : null,
  };
}

const EMPTY_KEYS: TableKeys = {};

export function useStaffSession(): {
  user: StaffUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithPin: (pin: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const repo = useAuthRepo();

  const subscribe = useMemo(
    () =>
      repo
        ? (listener: (user: StaffUser | null) => void) =>
            repo.subscribe(listener)
        : null,
    [repo],
  );

  const { value } = useLive<StaffUser | null>(subscribe, null);

  return {
    user: value,
    loading: !repo,
    signIn: useCallback(
      async (email, password) => {
        if (!repo) throw new Error("Storage is not ready yet.");
        await repo.signIn(email, password);
      },
      [repo],
    ),
    signUp: useCallback(
      async (email, password) => {
        if (!repo) throw new Error("Storage is not ready yet.");
        await repo.signUp(email, password);
      },
      [repo],
    ),
    signInWithPin: useCallback(
      async (pin) => {
        if (!repo) throw new Error("Storage is not ready yet.");
        await repo.signInWithPin(pin);
      },
      [repo],
    ),
    signOut: useCallback(async () => {
      if (!repo) return;
      await repo.signOut();
    }, [repo]),
  };
}

const NO_MEMBERS: StaffMember[] = [];
const NO_INVITES: Invite[] = [];

/**
 * The team and its invites, live, for /admin/staff. Owner-only: the rules
 * refuse anyone else, so only that page (behind the owner gate) calls this.
 */
export function useTeam(): {
  members: StaffMember[];
  invites: Invite[];
  loading: boolean;
  error: Error | null;
} {
  const repo = useStaffRepo();
  const [members, setMembers] = useState<{
    repo: StaffRepository;
    value: StaffMember[];
    error: Error | null;
  } | null>(null);
  const [invites, setInvites] = useState<{
    repo: StaffRepository;
    value: Invite[];
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    const offMembers = repo.subscribe(
      (value) => setMembers({ repo, value, error: null }),
      (error) => setMembers({ repo, value: [], error }),
    );
    const offInvites = repo.subscribeInvites(
      (value) => setInvites({ repo, value, error: null }),
      (error) => setInvites({ repo, value: [], error }),
    );
    return () => {
      offMembers();
      offInvites();
    };
  }, [repo]);

  const membersLoaded = members !== null && members.repo === repo;
  const invitesLoaded = invites !== null && invites.repo === repo;
  return {
    members: membersLoaded ? members.value : NO_MEMBERS,
    invites: invitesLoaded ? invites.value : NO_INVITES,
    loading: !membersLoaded || !invitesLoaded,
    error:
      (membersLoaded ? members.error : null) ??
      (invitesLoaded ? invites.error : null),
  };
}

/** Escape hatch for imperative writes (create order, update status, …). */
export function useActions() {
  const menu = useMenuRepo();
  const orders = useOrderRepo();
  const config = useConfigRepo();

  return useMemo(
    () => ({
      menu,
      orders,
      config,
    }),
    [menu, orders, config],
  );
}

/**
 * Every table's open-until time, live (src/lib/table-open.ts). The staff board
 * uses it for its "Open tables" strip and to keep a table open while staff
 * work on its orders.
 */
export function useTableSessions(enabled = true): {
  sessions: TableSessions;
  error: Error | null;
} {
  const repo = useSessionRepo();
  const [error, setError] = useState<Error | null>(null);
  const subscribe = useMemo(() => {
    if (!repo || !enabled) return null;
    return (listener: (sessions: TableSessions) => void) =>
      repo.subscribe((sessions) => {
        setError(null);
        listener(sessions);
      }, setError);
  }, [repo, enabled]);
  const { value } = useLive<TableSessions>(subscribe, EMPTY_SESSIONS);
  return { sessions: enabled ? value : EMPTY_SESSIONS, error };
}

const EMPTY_SESSIONS: TableSessions = {};

/** The owner's "Approve new tables" switch, live. OFF until known otherwise. */
export function useOrderingSettings(): {
  settings: OrderingSettings;
  loading: boolean;
} {
  const repo = useSessionRepo();
  const [snapshot, setSnapshot] = useState<{
    repo: SessionRepository;
    settings: OrderingSettings;
  } | null>(null);
  useEffect(() => {
    if (!repo) return;
    return repo.subscribeSettings((settings) =>
      setSnapshot({ repo, settings }),
    );
  }, [repo]);
  const loaded = snapshot !== null && snapshot.repo === repo;
  return {
    settings: loaded ? snapshot.settings : DEFAULT_ORDERING,
    loading: !loaded,
  };
}

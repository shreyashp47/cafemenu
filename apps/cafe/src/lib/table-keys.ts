/**
 * Per-table secret codes: what stops an order from anywhere but the table.
 *
 * Ordering is pay-at-the-counter, and the order page used to need nothing but a
 * table number, so anyone who had ever seen the address could order for table 2
 * from home by typing `/order?table=2`. The cost is prank and wasted orders, not
 * lost money, but it is real.
 *
 * So each table gets a random code, stored in Firestore at `tableKeys/{table}`
 * (owner-only: customers and staff can never read one), and printed into that
 * table's QR code as `/order?table=2&k=CODE`. The order rule in firestore.rules
 * refuses an order for a table that has a code unless the order carries it.
 *
 * The phone keeps a scanned code for TABLE_CODE_TTL_MS (3 hours) and the order
 * page takes it out of the address bar straight away, so it is not left in
 * history, bookmarks or a shared link. A visit last week no longer lets anyone
 * order from home.
 *
 * What it does not do: a photo of the QR code still works from anywhere, until
 * the owner presses "New code" for that table and reprints the card. It raises
 * the bar from "knows the address" to "has been at the table recently". See
 * docs/decisions.md.
 *
 * Transition: a table with no code yet takes orders without one, exactly as
 * before, so deploying this changes nothing until the owner presses "Create
 * codes" on /admin/qr and puts the new cards out.
 */

/** Length of a new code. 62^12 is about 3 * 10^21: not guessable by retrying. */
export const TABLE_KEY_LENGTH = 12;
/** Bounds firestore.rules accepts, for both the stored code and the order field. */
export const MIN_TABLE_KEY_LENGTH = 10;
export const MAX_TABLE_KEY_LENGTH = 64;

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** table number -> code, for the tables that have one. */
export type TableKeys = Readonly<Record<number, string>>;

/**
 * A fresh random code, base62. Uses the platform CSPRNG, never Math.random: the
 * code is the whole protection, so it must not be predictable from another one.
 * Bytes of 248 and over are thrown away rather than folded in with `% 62`, which
 * would make the first eight characters of the alphabet slightly likelier.
 */
export function generateTableKey(
  length: number = TABLE_KEY_LENGTH,
  fill: (bytes: Uint8Array) => Uint8Array = (b) =>
    globalThis.crypto.getRandomValues(b),
): string {
  const limit = 256 - (256 % ALPHABET.length); // 248
  let out = "";
  while (out.length < length) {
    for (const byte of fill(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** The shape a code can have. Anything else in `?k=` is ignored. */
export function isTableKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_TABLE_KEY_LENGTH &&
    value.length <= MAX_TABLE_KEY_LENGTH &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

/** Tables in `tables` that have no code yet, in order. */
export function tablesWithoutKey(
  tables: readonly number[],
  keys: TableKeys,
): number[] {
  return tables.filter((n) => !isTableKey(keys[n]));
}

// --- the customer's phone ------------------------------------------------------

/**
 * How long a scanned code stays usable on the phone: 3 hours from the scan.
 *
 * Long enough for any real visit, including a slow lunch and a second round,
 * short enough that the code is gone by the time the customer is home. Before
 * this the phone kept it forever, so anyone who had once sat at table 2 could
 * order for table 2 from the sofa. Scanning again restarts the clock.
 */
export const TABLE_CODE_TTL_MS = 3 * 60 * 60 * 1000;

const PREFIX = "toe.tableKey.t";

/**
 * How far in the future a scan time may be and still count: a little clock
 * skew between saving and reading is harmless, but a scan "from tomorrow"
 * (the phone's clock was wrong, then corrected) would stretch the 3 hours
 * indefinitely, so it counts as expired.
 */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** What the phone holds for one table. `k` is dropped once it has expired. */
interface Saved {
  k?: string;
  /** When the card was scanned, ms since the epoch. */
  at: number;
}

// Where a code is kept, most durable first. localStorage lasts across visits
// (within the 3 hours); sessionStorage is the fallback when localStorage is
// full or refused, and still survives the full page load to the confirmation
// page and back. The in-memory copy covers a browser that refuses both, for
// this page load only: such a phone is asked to scan again after ordering. It
// holds only what could not be stored, so it never outvotes storage.
const memory = new Map<number, Saved>();
const stores = (): Storage[] => {
  const out: Storage[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = globalThis[name];
      if (store) out.push(store);
    } catch {
      /* access itself can throw */
    }
  }
  return out;
};

/**
 * The phone's view of a table's code, judged at `now`:
 * - `valid`: scanned within TABLE_CODE_TTL_MS; `key` goes with the order.
 * - `expired`: scanned before, too long ago. The table therefore has a code
 *   (codes are renewed, never removed), so an order without one is sure to be
 *   refused: the customer is asked to scan before trying.
 * - `none`: never scanned here. The phone cannot tell whether this table has a
 *   code (codes are unreadable to customers), so the order is tried and the
 *   rules decide.
 */
export type TableCode =
  | { state: "valid"; key: string; expiresAt: number }
  | { state: "expired" }
  | { state: "none" };

/**
 * Remember the code a customer scanned, with the time of the scan. A newer
 * scan always replaces it, which both restarts the 3 hours and is how a renewed
 * code reaches a phone that had the old one.
 */
export function rememberTableKey(
  tableNumber: number,
  key: string,
  now: number = Date.now(),
): void {
  if (!isTableKey(key)) return;
  write(tableNumber, { k: key, at: now });
}

export function readTableCode(
  tableNumber: number,
  now: number = Date.now(),
): TableCode {
  const saved = read(tableNumber);
  if (!saved) return { state: "none" };
  const expiresAt = saved.at + TABLE_CODE_TTL_MS;
  if (saved.k && now < expiresAt && saved.at <= now + FUTURE_SKEW_MS) {
    return { state: "valid", key: saved.k, expiresAt };
  }
  // Scrub the stale code but keep the scan time: "this table has a code" is
  // still worth knowing, the code itself no longer is.
  if (saved.k) write(tableNumber, { at: saved.at });
  return { state: "expired" };
}

/** The code to send with an order right now, or null. */
export function readTableKey(
  tableNumber: number,
  now: number = Date.now(),
): string | null {
  const code = readTableCode(tableNumber, now);
  return code.state === "valid" ? code.key : null;
}

/**
 * The newest record among the stores and memory. Newest, not first found: a
 * scan saved only to sessionStorage or memory (localStorage full) must not be
 * shadowed by an older expired entry that is still in localStorage, and a
 * rescan in another tab must win over this tab's memory.
 */
function read(tableNumber: number): Saved | null {
  const name = `${PREFIX}${tableNumber}`;
  let best: Saved | null = memory.get(tableNumber) ?? null;
  for (const store of stores()) {
    try {
      const raw = store.getItem(name);
      if (raw == null) continue;
      const saved = parseSaved(raw);
      if (!saved) {
        store.removeItem(name); // junk: as if never scanned
        continue;
      }
      if (!best || saved.at > best.at) best = saved;
    } catch {
      /* try the next one */
    }
  }
  return best;
}

function write(tableNumber: number, saved: Saved): void {
  const name = `${PREFIX}${tableNumber}`;
  const value = JSON.stringify(saved);
  for (const store of stores()) {
    try {
      store.setItem(name, value);
      // Stored: storage is the one copy, so it alone decides from now on.
      memory.delete(tableNumber);
      return;
    } catch {
      /* full or refused: try the next one */
    }
  }
  memory.set(tableNumber, saved);
}

/**
 * A code saved before scan times were kept is a bare string. It has no time,
 * so it counts as expired: it proves the table has a code, nothing more.
 * Anything else unreadable is `null`, read as "never scanned", so a stray
 * value cannot switch ordering off at a table that has no code.
 */
function parseSaved(raw: string): Saved | null {
  if (isTableKey(raw)) return { at: 0 };
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object") {
      const { k, at } = value as { k?: unknown; at?: unknown };
      if (typeof at === "number" && Number.isFinite(at)) {
        return isTableKey(k) ? { k, at } : { at };
      }
    }
  } catch {
    /* junk */
  }
  return null;
}

/** Used by tests. */
export function forgetTableKeys(): void {
  memory.clear();
  for (const store of stores()) {
    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const k = store.key(i);
        if (k?.startsWith(PREFIX)) store.removeItem(k);
      }
    } catch {
      /* nothing to forget */
    }
  }
}

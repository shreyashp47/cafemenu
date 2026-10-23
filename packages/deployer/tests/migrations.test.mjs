/**
 * The migrations runner and migrations/0002-money-minor-units.mjs, against
 * the fake Google. tests/emulator/ runs 0002 on the Firestore emulator too.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { decodeFields, encodeFields } from "../src/apis/firestore.mjs";
import { migrate } from "../src/commands/migrate.mjs";
import { ActionNeededError } from "../src/errors.mjs";
import {
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { SETTINGS } from "./helpers/release.mjs";
import { cli, context, tempDir, writeTree } from "./helpers/setup.mjs";

const REPO_MIGRATIONS = fileURLToPath(
  new URL("../../../migrations/", import.meta.url),
);

/** TOE's settings until 0002: whole rupees (apps/cafe/fixtures/toe.json). */
const TOE = {
  ...SETTINGS,
  name: "TOE Cafe",
  moneyUnit: "major",
  maxOrderTotal: 10000,
};

const MENU = {
  latte: 180,
  cappuccino: 160,
  brownie: 120,
  sandwich: 250,
  tea: 40,
};
const ORDERS = {
  o1: [["latte", 2]],
  o2: [
    ["tea", 1],
    ["brownie", 1],
  ],
  o3: [["sandwich", 1]],
  o4: [
    ["latte", 1],
    ["cappuccino", 1],
    ["tea", 2],
  ],
  o5: [["brownie", 3]],
  o6: [["cappuccino", 2]],
  o7: [
    ["sandwich", 2],
    ["latte", 1],
  ],
};
// Never read or written by 0002.
const UNTOUCHED = {
  "dayCounters/2026-10-01": { next: 8, last: 7 },
  "tableKeys/1": { key: "k".repeat(32) },
  "staff/owner-uid": { name: "Asha", role: "owner", email: "asha@example.com" },
};

function order(lines) {
  const items = lines.map(([id, qty]) => ({
    menuItemId: id,
    name: id,
    qty,
    price: MENU[id],
  }));
  return {
    tableNumber: 3,
    items,
    total: items.reduce((sum, line) => sum + line.price * line.qty, 0),
    status: "completed",
  };
}

/** A cafe on the fake Google with TOE's data: rupees, schema 1. */
function toeCafe({ site = TOE } = {}) {
  const state = freshState();
  state.services.set("firestore.googleapis.com", "ENABLED");
  const put = (path, data) => state.docs.set(path, encodeFields(data));
  if (site) put("config/site", site);
  for (const [id, price] of Object.entries(MENU))
    put(`menu/${id}`, { name: id, price, category: "Coffee", available: true });
  for (const [id, lines] of Object.entries(ORDERS))
    put(`orders/${id}`, order(lines));
  for (const [path, data] of Object.entries(UNTOUCHED)) put(path, data);
  const google = createFakeGoogle({ state });
  return {
    google,
    state,
    put,
    doc: (path) =>
      state.docs.has(path) ? decodeFields(state.docs.get(path)) : null,
    run: (options = {}, { dryRun = false } = {}) => {
      const ctx = context(google, { dryRun });
      return {
        ctx,
        done: migrate(ctx, { to: 2, dir: REPO_MIGRATIONS, ...options }),
      };
    },
  };
}

const writes = (google, from = 0) => google.calls.slice(from).filter(isWrite);

/** Every amount in the cafe, keyed by where it is. */
function amounts(c) {
  const out = {};
  for (const id of Object.keys(MENU))
    out[`menu/${id}`] = c.doc(`menu/${id}`).price;
  for (const id of Object.keys(ORDERS)) {
    const o = c.doc(`orders/${id}`);
    out[`orders/${id}.total`] = o.total;
    o.items.forEach(
      (line, i) => (out[`orders/${id}.items[${i}]`] = line.price),
    );
  }
  return out;
}

const times100 = (before) =>
  Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v * 100]));

/** Writes migrations into a fresh folder: {"0002-a.mjs": source}. */
async function migrationsDir(files) {
  return writeTree(await tempDir(), files);
}

const migration = (from, to, body = "") => `export const from = ${from};
export const to = ${to};
export const describe = "step ${to}";
export async function up(db) {${body}}
`;

describe("the migrations runner", () => {
  it("runs the migrations in order, each from where the one before ended", async () => {
    const c = toeCafe();
    const dir = await migrationsDir({
      "0003-b-from-a.mjs": migration(
        2,
        3,
        `await db.each("menu", "menu", (item) => ({ b: item.a + 1 }));`,
      ),
      "0002-a.mjs": migration(
        1,
        2,
        `await db.each("menu", "menu", () => ({ a: 1 }));`,
      ),
      "0004-not-yet.mjs": migration(3, 4, `throw new Error("ran 0004");`),
      "README.md": "not a migration",
    });
    const { ctx, done } = c.run({ dir, to: 3 });
    const result = await done;

    assert.deepEqual(result.ran, ["0002-a.mjs", "0003-b-from-a.mjs"]);
    for (const id of Object.keys(MENU)) {
      assert.equal(c.doc(`menu/${id}`).a, 1);
      assert.equal(c.doc(`menu/${id}`).b, 2);
    }
    assert.deepEqual(c.doc("config/meta"), { schemaVersion: 3 });
    const out = ctx.output();
    assert.ok(out.indexOf("0002-a.mjs") < out.indexOf("0003-b-from-a.mjs"));
    assert.match(out, /\+ data at schema 2 \(config\/meta\)/);
    assert.match(out, /\+ data at schema 3 \(config\/meta\)/);
  });

  it("refuses a migration whose from doesn't match, before writing anything", async () => {
    const c = toeCafe();
    const dir = await migrationsDir({
      "0002-a.mjs": migration(
        1,
        2,
        `await db.each("menu", "menu", () => ({ a: 1 }));`,
      ),
      "0003-skips-2.mjs": migration(1, 3),
    });
    await assert.rejects(c.run({ dir, to: 3 }).done, (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(
        error.message,
        /0003-skips-2\.mjs migrates data at schema 1, but the cafe's would be at schema 2/,
      );
      return true;
    });
    assert.deepEqual(writes(c.google), []);

    c.put("config/meta", { schemaVersion: 2 });
    await assert.rejects(
      c.run({ dir, to: 3 }).done,
      /0003-skips-2\.mjs migrates data at schema 1, but the cafe's is at schema 2/,
    );
    assert.deepEqual(writes(c.google), []);
  });

  it("refuses a migration that doesn't say what it is", async () => {
    const c = toeCafe();
    const dir = await migrationsDir({
      "0002-wrong.mjs": "export const from = 1;\nexport const to = 3;\n",
    });
    await assert.rejects(
      c.run({ dir }).done,
      /0002-wrong\.mjs: `to` must be 2, the number in its name; `describe` must say what it does; `up\(db\)` must be a function/,
    );
    assert.deepEqual(writes(c.google), []);
  });

  it("does nothing on data already at the schema", async () => {
    const c = toeCafe();
    c.put("config/meta", { schemaVersion: 2 });
    const { ctx, done } = c.run();
    assert.deepEqual((await done).ran, []);
    assert.match(ctx.output(), /= already at schema 2: nothing to migrate/);
    assert.deepEqual(writes(c.google), []);
  });
});

describe("0002: whole rupees to paise", () => {
  it("multiplies every amount by 100 and switches config/site to minor units", async () => {
    const c = toeCafe();
    const before = amounts(c);
    const { ctx, done } = c.run();
    await done;

    assert.deepEqual(amounts(c), times100(before));
    const site = c.doc("config/site");
    assert.equal(site.schemaVersion, 2);
    assert.equal(site.moneyUnit, "minor");
    assert.equal(site.maxOrderTotal, 1000000);
    assert.equal(site.name, "TOE Cafe");
    assert.deepEqual(c.doc("config/meta"), { schemaVersion: 2 });
    for (const [path, data] of Object.entries(UNTOUCHED))
      assert.deepEqual(c.doc(path), data);
    const out = ctx.output();
    assert.match(out, /\+ menu: multiplied 5 of 5 prices by 100/);
    assert.match(
      out,
      /\+ orders: multiplied the totals and line prices of 7 of 7 orders by 100/,
    );
    assert.match(
      out,
      /\+ config\/site: "moneyUnit": "minor", "maxOrderTotal": 1000000/,
    );
    assert.match(out, /Done: test-cafe's data is at schema 2\./);
  });

  it("never writes dayCounters, tableKeys or staff", async () => {
    const c = toeCafe();
    await c.run({ batchSize: 2 }).done;
    const written = writes(c.google).flatMap((call) =>
      (call.body.writes ?? []).map(
        (w) => w.update.name.split("/documents/")[1],
      ),
    );
    assert.ok(written.length > 0);
    assert.deepEqual(
      [...new Set(written.map((path) => path.split("/")[0]))].sort(),
      ["config", "menu", "orders"],
    );
    assert.deepEqual(
      [...new Set(written.filter((p) => p.startsWith("config/")))].sort(),
      ["config/meta", "config/site"],
    );
  });

  it("carries on after a run cut off halfway, multiplying nothing twice", async () => {
    const c = toeCafe();
    const before = amounts(c);
    // Commits: 2 to start, menu in pages of 2 (3), orders (4), config/site,
    // then config/meta. The 7th is the orders' second page.
    c.state.failCommits.add(7);
    await assert.rejects(
      c.run({ batchSize: 2 }).done,
      /failed \(503 UNAVAILABLE\)/,
    );

    const half = amounts(c);
    for (const id of Object.keys(MENU))
      assert.equal(half[`menu/${id}`], before[`menu/${id}`] * 100);
    assert.equal(half["orders/o2.total"], before["orders/o2.total"] * 100);
    assert.equal(half["orders/o3.total"], before["orders/o3.total"]);
    const meta = c.doc("config/meta");
    assert.equal(meta.schemaVersion, undefined);
    assert.equal(meta.migration.to, 2);
    assert.equal(meta.migration.steps.menu.done, true);
    assert.match(meta.migration.steps.orders.after, /\/documents\/orders\/o2$/);
    assert.equal(c.doc("config/site").moneyUnit, "major");

    const { ctx, done } = c.run({ batchSize: 2 });
    await done;
    assert.match(ctx.output(), /! a migration to schema 2 stopped part way/);
    assert.match(
      ctx.output(),
      /resuming: it started at 2026-10-01T00:01:00\.000Z, and got as far as menu, orders/,
    );
    assert.deepEqual(amounts(c), times100(before));
    assert.deepEqual(c.doc("config/meta"), { schemaVersion: 2 });
    assert.equal(c.doc("config/site").maxOrderTotal, 1000000);
  });

  it("does it again from scratch if the cut comes before anything is saved", async () => {
    const c = toeCafe();
    const before = amounts(c);
    c.state.failCommits.add(1);
    await assert.rejects(c.run().done, /503/);
    assert.deepEqual(amounts(c), before);
    await c.run().done;
    assert.deepEqual(amounts(c), times100(before));
  });

  it("a dry run counts what it would change and writes nothing", async () => {
    const c = toeCafe();
    const before = amounts(c);
    const { ctx, done } = c.run({ batchSize: 2 }, { dryRun: true });
    await done;

    assert.deepEqual(writes(c.google), []);
    assert.deepEqual(amounts(c), before);
    assert.equal(c.doc("config/meta"), null);
    const out = ctx.output();
    assert.match(out, /~ menu: would multiply 5 of 5 prices by 100/);
    assert.match(
      out,
      /~ orders: would multiply the totals and line prices of 7 of 7 orders by 100 \(11 lines\)/,
    );
    assert.match(
      out,
      /~ config\/site: would set "moneyUnit": "minor", "maxOrderTotal": 1000000/,
    );
    assert.match(out, /~ would record schema 2 in config\/meta/);
    assert.match(out, /Dry run: 4 change\(s\) would be made\./);
  });

  it("a second run changes nothing", async () => {
    const c = toeCafe();
    await c.run().done;
    const after = amounts(c);
    const calls = c.google.calls.length;
    const { ctx, done } = c.run();
    await done;
    assert.deepEqual(writes(c.google, calls), []);
    assert.deepEqual(amounts(c), after);
    assert.match(ctx.output(), /already at schema 2/);
  });

  it("leaves documents created after it started alone, and says so", async () => {
    const c = toeCafe();
    const before = amounts(c);
    c.state.afterCommit = (n) => {
      // Once the migration has its start time: an order placed meanwhile.
      if (n !== 2) return;
      c.put("orders/o9", order([["latte", 1]]));
      c.state.docTimes.set("orders/o9", {
        createTime: "2026-10-01T00:05:00.000Z",
        updateTime: "2026-10-01T00:05:00.000Z",
      });
    };
    const { ctx, done } = c.run();
    await done;
    assert.deepEqual(amounts(c), times100(before));
    assert.equal(c.doc("orders/o9").total, 180);
    assert.match(
      ctx.output(),
      /! 1 orders created after the migration started \(2026-10-01T00:01:00\.000Z\) were left as they are/,
    );
  });

  it("changes no amounts on a cafe already in minor units", async () => {
    const c = toeCafe({ site: SETTINGS });
    const before = amounts(c);
    const { ctx, done } = c.run();
    await done;
    assert.deepEqual(amounts(c), before);
    assert.deepEqual(c.doc("config/site"), SETTINGS);
    assert.deepEqual(c.doc("config/meta"), { schemaVersion: 2 });
    assert.match(ctx.output(), /= config\/site already counts minor units/);
  });

  it("reads a settings schema 1 config/site as whole rupees, and TOE with none at all", async () => {
    const legacy = toeCafe({
      site: { schemaVersion: 1, name: "TOE Cafe", moneyUnit: "minor" },
    });
    const before = amounts(legacy);
    await legacy.run().done;
    assert.deepEqual(amounts(legacy), times100(before));
    assert.equal(legacy.doc("config/site").maxOrderTotal, 1000000);

    const none = toeCafe({ site: null });
    await none.run().done;
    assert.deepEqual(amounts(none), times100(before));
    assert.deepEqual(none.doc("config/site"), {
      schemaVersion: 2,
      moneyUnit: "minor",
      maxOrderTotal: 1000000,
    });
  });
});

describe("deployer migrate", () => {
  it("runs from the command line", async () => {
    const state = freshState();
    state.services.set("firestore.googleapis.com", "ENABLED");
    state.docs.set("config/site", encodeFields(TOE));
    state.docs.set("menu/latte", encodeFields({ name: "Latte", price: 180 }));
    const { run } = await cli({ state });

    const dry = await run("migrate", "--to", "2", "--dry-run");
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /would multiply 1 of 1 prices by 100/);
    assert.equal(decodeFields(state.docs.get("menu/latte")).price, 180);

    const real = await run("migrate", "--to", "2");
    assert.equal(real.code, 0, real.err);
    assert.equal(decodeFields(state.docs.get("menu/latte")).price, 18000);
  });

  it("needs a schema version", async () => {
    const { run } = await cli();
    for (const args of [
      ["migrate"],
      ["migrate", "--to", "two"],
      ["migrate", "--to", "0"],
    ]) {
      const { code, err } = await run(...args);
      assert.equal(code, 2);
      assert.match(err, /--to/);
    }
  });
});

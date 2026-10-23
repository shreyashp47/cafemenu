/**
 * migrations/0002-money-minor-units.mjs on the Firestore emulator, through
 * the deployer's own REST adapter: TOE-like data (its settings, a menu and a
 * month of orders) migrated, checked amount by amount and report by report,
 * then migrated again to show a second run changes nothing.
 *
 *   npm run test:emulator -w @cafemenu/deployer
 *
 * starts the emulator (Java 21) on port 8280 (tests/emulator/firebase.json)
 * and runs this file; without FIRESTORE_EMULATOR_HOST it is skipped, so the
 * plain `npm test` stays offline.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";

import {
  commit,
  decodeFields,
  documentName,
  encodeFields,
  queryCollection,
} from "../../src/apis/firestore.mjs";
import { migrate } from "../../src/commands/migrate.mjs";
import { createGoogleClient } from "../../src/http.mjs";
import { createLogger } from "../../src/log.mjs";

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-cafemenu";
const TOE = JSON.parse(
  await readFile(
    new URL("../../../../apps/cafe/fixtures/toe.json", import.meta.url),
    "utf8",
  ),
);

/**
 * fetch, with Google's Firestore host pointed at the emulator.
 * `onCommit(n, send, body)` may stand in for the nth commit.
 */
function emulatorFetch({ onCommit } = {}) {
  let commits = 0;
  const fetchImpl = async (input, init) => {
    const url = String(input).replace(
      "https://firestore.googleapis.com/",
      `http://${HOST}/`,
    );
    const send = () => fetch(url, init);
    if (url.endsWith(":commit")) {
      commits += 1;
      if (onCommit) return onCommit(commits, send, JSON.parse(init.body));
    }
    return send();
  };
  return { fetchImpl, commits: () => commits };
}

/** A command context as the service account: the emulator takes "owner" as an admin token. */
function context({
  dryRun = false,
  fetchImpl = emulatorFetch().fetchImpl,
} = {}) {
  const lines = [];
  return {
    api: createGoogleClient({
      fetchImpl,
      getToken: async () => "owner",
      dryRun,
      sleep: async () => {},
    }),
    log: createLogger({ write: (line) => lines.push(line), dryRun }),
    project: PROJECT,
    dryRun,
    output: () => lines.join("\n"),
  };
}

// --- TOE's data ---------------------------------------------------------------

/** The same numbers every run. */
function random(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s % n;
  };
}

function toeData() {
  const pick = random(21);
  const docs = new Map(); // path → Firestore fields
  docs.set("config/site", encodeFields(TOE));
  const menu = [];
  for (let i = 0; i < 24; i += 1) {
    const item = {
      name: `Item ${i + 1}`,
      description: "",
      price: 40 + 10 * pick(30), // ₹40 to ₹330, whole rupees
      category: ["Coffee", "Tea", "Food"][i % 3],
      available: true,
      sortOrder: i,
    };
    menu.push({ id: `item${String(i).padStart(2, "0")}`, ...item });
    docs.set(`menu/${menu.at(-1).id}`, encodeFields(item));
  }
  // October 2026: 15 orders a day, one table in eight declined now and then.
  for (let day = 1; day <= 31; day += 1) {
    const dayKey = `2026-10-${String(day).padStart(2, "0")}`;
    for (let n = 1; n <= 15; n += 1) {
      const items = Array.from({ length: 1 + pick(4) }, () => {
        const m = menu[pick(menu.length)];
        return {
          menuItemId: m.id,
          name: m.name,
          qty: 1 + pick(3),
          price: m.price,
        };
      });
      const order = {
        orderNumber: 100 + n,
        dayNumber: n,
        dayKey,
        tableNumber: 1 + pick(8),
        items,
        total: items.reduce((sum, line) => sum + line.price * line.qty, 0),
        status: pick(8) === 0 ? "rejected" : "completed",
        uid: `guest-${day}-${n}`,
      };
      docs.set(`orders/${dayKey}-${String(n).padStart(2, "0")}`, {
        ...encodeFields(order),
        createdAt: {
          timestampValue: `${dayKey}T${String(8 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "15" : "45"}:00Z`,
        },
      });
    }
    docs.set(`dayCounters/${dayKey}`, encodeFields({ next: 16, last: 15 }));
  }
  for (let t = 1; t <= 8; t += 1)
    docs.set(
      `tableKeys/${t}`,
      encodeFields({ key: `key-${t}`.padEnd(32, "x") }),
    );
  docs.set(
    "staff/owner-uid",
    encodeFields({
      name: "TOE owner",
      role: "owner",
      email: "owner@example.com",
    }),
  );
  docs.set(
    "staff/barista-uid",
    encodeFields({
      name: "Barista",
      role: "staff",
      email: "barista@example.com",
    }),
  );
  return docs;
}

async function reset() {
  const res = await fetch(
    `http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.ok(res.ok, `clearing the emulator: ${res.status}`);
}

async function seed(docs) {
  const { api } = context();
  const writes = [...docs].map(([path, fields]) => ({
    update: { name: documentName(PROJECT, path), fields },
  }));
  for (let i = 0; i < writes.length; i += 400)
    await commit(api, PROJECT, writes.slice(i, i + 400));
}

/** Every document of the collections TOE has: path → {data, updateTime}. */
async function snapshot() {
  const { api } = context();
  const out = new Map();
  for (const collection of [
    "config",
    "menu",
    "orders",
    "dayCounters",
    "tableKeys",
    "staff",
  ]) {
    let after;
    for (;;) {
      const docs = await queryCollection(api, PROJECT, collection, {
        after,
        limit: 300,
      });
      for (const doc of docs)
        out.set(doc.name.split("/documents/")[1], {
          data: decodeFields(doc.fields),
          fields: doc.fields,
          updateTime: doc.updateTime,
        });
      if (docs.length < 300) break;
      after = docs.at(-1).name;
    }
  }
  return out;
}

const pathsIn = (snap, collection) =>
  [...snap.keys()].filter((p) => p.startsWith(`${collection}/`));

/**
 * What /admin/reports adds up: revenue from the lines of completed orders,
 * by day and for the month, and the stored totals beside it.
 */
function report(snap) {
  const days = {};
  let revenue = 0;
  let totals = 0;
  for (const path of pathsIn(snap, "orders")) {
    const o = snap.get(path).data;
    if (o.status !== "completed") continue;
    const lines = o.items.reduce((sum, line) => sum + line.price * line.qty, 0);
    days[o.dayKey] = (days[o.dayKey] ?? 0) + lines;
    revenue += lines;
    totals += o.total;
  }
  return { days, revenue, totals };
}

const scaled = ({ days, revenue, totals }, by) => ({
  days: Object.fromEntries(Object.entries(days).map(([d, v]) => [d, v * by])),
  revenue: revenue * by,
  totals: totals * by,
});

// --- the tests ------------------------------------------------------------------

describe(
  "0002 on the Firestore emulator",
  { skip: HOST ? false : "needs the emulator: npm run test:emulator" },
  () => {
    let before;
    beforeEach(async () => {
      await reset();
      await seed(toeData());
      before = await snapshot();
    });

    it("multiplies every amount by 100 exactly once, and a second run changes nothing", async () => {
      assert.equal(pathsIn(before, "orders").length, 465);
      const ctx = context();
      const result = await migrate(ctx, { to: 2, batchSize: 50 });
      assert.deepEqual(result.ran, ["0002-money-minor-units.mjs"]);
      const after = await snapshot();

      for (const path of pathsIn(before, "menu"))
        assert.equal(
          after.get(path).data.price,
          before.get(path).data.price * 100,
          path,
        );
      for (const path of pathsIn(before, "orders")) {
        const [was, now] = [before.get(path).data, after.get(path).data];
        assert.equal(now.total, was.total * 100, path);
        assert.deepEqual(
          now.items,
          was.items.map((line) => ({ ...line, price: line.price * 100 })),
          path,
        );
        // Everything else on the order is as it was, createdAt included.
        const { total, items, ...rest } = after.get(path).fields;
        const { total: t, items: i, ...restBefore } = before.get(path).fields;
        assert.deepEqual(rest, restBefore, path);
      }

      // The reports, in paise, are the rupee reports times 100.
      const rupees = report(before);
      assert.ok(rupees.revenue > 0);
      assert.deepEqual(report(after), scaled(rupees, 100));

      assert.deepEqual(after.get("config/site").data, {
        ...TOE,
        schemaVersion: 2,
        moneyUnit: "minor",
        maxOrderTotal: 1000000,
      });
      assert.deepEqual(after.get("config/meta").data, { schemaVersion: 2 });
      for (const collection of ["dayCounters", "tableKeys", "staff"]) {
        assert.ok(pathsIn(before, collection).length > 0);
        for (const path of pathsIn(before, collection))
          assert.deepEqual(after.get(path), before.get(path), path);
      }
      assert.match(ctx.output(), /\+ menu: multiplied 24 of 24 prices by 100/);
      assert.match(
        ctx.output(),
        /\+ orders: multiplied the totals and line prices of 465 of 465 orders by 100/,
      );

      const again = emulatorFetch();
      await migrate(context({ fetchImpl: again.fetchImpl }), { to: 2 });
      assert.equal(again.commits(), 0);
      assert.deepEqual(await snapshot(), after);
    });

    it("carries on after a commit whose answer never came, without doubling it", async () => {
      // Two commits to start, the menu in three pages of 10, and then the
      // orders' first page: it reaches Firestore, and the deployer never
      // hears back.
      const lost = emulatorFetch({
        onCommit: async (n, send) => {
          const res = await send();
          if (n === 6) throw new TypeError("fetch failed");
          return res;
        },
      });
      await assert.rejects(
        migrate(context({ fetchImpl: lost.fetchImpl }), {
          to: 2,
          batchSize: 10,
        }),
        /did not get an answer/,
      );
      const half = await snapshot();
      assert.equal(half.get("config/meta").data.migration.to, 2);
      assert.equal(half.get("config/site").data.moneyUnit, "major");

      const ctx = context();
      await migrate(ctx, { to: 2, batchSize: 10 });
      assert.match(ctx.output(), /resuming/);
      const after = await snapshot();
      for (const path of pathsIn(before, "menu"))
        assert.equal(
          after.get(path).data.price,
          before.get(path).data.price * 100,
          path,
        );
      for (const path of pathsIn(before, "orders"))
        assert.equal(
          after.get(path).data.total,
          before.get(path).data.total * 100,
          path,
        );
      assert.deepEqual(report(after), scaled(report(before), 100));
      assert.deepEqual(after.get("config/meta").data, { schemaVersion: 2 });
    });

    it("refuses a page that changed since it was read, and the next run finishes", async () => {
      // A staff tablet touches an order of the 5th commit's page (orders
      // 51 to 100) between the runner's read and its commit.
      let touched;
      const raced = emulatorFetch({
        onCommit: async (n, send, body) => {
          if (n === 5) {
            touched = body.writes[0].update.name.split("/documents/")[1];
            await commit(context().api, PROJECT, [
              {
                update: {
                  name: documentName(PROJECT, touched),
                  fields: encodeFields({ status: "completed" }),
                },
                updateMask: { fieldPaths: ["status"] },
              },
            ]);
          }
          return send();
        },
      });
      await assert.rejects(
        migrate(context({ fetchImpl: raced.fetchImpl }), {
          to: 2,
          batchSize: 50,
        }),
        /Something else wrote to the cafe's data while 0002-money-minor-units\.mjs ran/,
      );
      const half = await snapshot();
      assert.match(touched, /^orders\//);
      assert.equal(
        half.get(touched).data.total,
        before.get(touched).data.total,
      );
      const firstPage = pathsIn(before, "orders")[0];
      assert.equal(
        half.get(firstPage).data.total,
        before.get(firstPage).data.total * 100,
      );

      await migrate(context(), { to: 2, batchSize: 50 });
      const after = await snapshot();
      for (const path of pathsIn(before, "orders"))
        assert.equal(
          after.get(path).data.total,
          before.get(path).data.total * 100,
          path,
        );
    });

    it("a dry run writes nothing", async () => {
      const dry = emulatorFetch();
      const ctx = context({ dryRun: true, fetchImpl: dry.fetchImpl });
      await migrate(ctx, { to: 2 });
      assert.equal(dry.commits(), 0);
      assert.deepEqual(await snapshot(), before);
      assert.match(
        ctx.output(),
        /~ menu: would multiply 24 of 24 prices by 100/,
      );
    });
  },
);

/**
 * How a customer actually gets to the menu — every way in.
 *
 * `scripts/flow.mjs` walks the order/staff/status flow from one QR link. This
 * checks every other door: the bare site, a link with and without the table's
 * code, and every kind of broken table number.
 *
 * There used to be a table picker here — land on the site, tap your number —
 * and this script tapped every tile. The picker is gone: a tapped number cannot
 * carry the table's secret code (src/lib/table-keys.ts), so once the owner turns
 * codes on it would lead to a menu that refuses the order at checkout. The
 * front door now asks the customer to scan, and step 2 checks that it offers no
 * table buttons at all.
 *
 * This script drives each entry separately and prints what actually rendered, so
 * a difference between two ways in is obvious rather than inferred.
 *
 *   npm run test:entry                       # spawns `next dev`
 *   BASE_URL=https://toe-cafe.web.app npm run test:entry
 *
 * Read-only: it navigates and reads the page, and never places an order, so
 * pointing it at the live site is safe. CI runs it against the built `out/`.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, devices } from "playwright";

const PORT = 4313;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

let failures = 0;
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
function check(label, ok, extra = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const dev = process.env.BASE_URL
  ? null
  : spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
if (dev && !(await waitForServer(BASE))) {
  dev.kill("SIGKILL");
  console.error("dev server never came up");
  process.exit(1);
}

/**
 * Waits for the screen to stop changing, rather than sleeping a fixed amount.
 *
 * Two fixed sleeps were wrong here. On a cold CDN the root page is a static
 * export of a `redirect()`, so the hop to /order happens after hydration and two
 * runs of the same commit disagreed. And matching a specific loader string is
 * worse: the app has several ("Finding your table...", "Setting out the cups...")
 * and matching one of them lets the wait return while a different loader is still
 * on screen. Reading until the text holds steady is independent of the copy.
 */
async function waitForMenu(page, ms = 15_000) {
  // A price on screen is what "the menu is here" means. After a client-side
  // navigation the menu is re-read from Firestore, so this legitimately takes a
  // couple of seconds; the QR path is instant because the shell is already warm.
  await page
    .getByText(/\u20b9\s*\d/)
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .catch(() => {});
}

async function settle(page, ms = 10_000) {
  const deadline = Date.now() + ms;
  let previous = null;
  while (Date.now() < deadline) {
    const now = (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");
    if (now && now === previous) return;
    previous = now;
    await page.waitForTimeout(250);
  }
}

/** What the customer is actually looking at, in one word. */
async function classify(page) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // The prompt's heading, not any mention: the menu itself hints "To order,
  // scan the QR code on your table" to a phone that has not scanned.
  const heading = (await page.locator("h1").allInnerTexts()).join(" ");
  if (/scan the qr code on your table/i.test(heading)) return "scan prompt";
  // The same component with a different heading, for a number that parses but is
  // not a table this cafe has. A clean landing either way.
  if (/that table number looks odd/i.test(text)) return "odd-table notice";
  if (/mascot|loading/i.test(text) && text.length < 80) return "still loading";
  if (text.includes("₹")) return "menu";
  return `unknown: ${text.slice(0, 60)}`;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 13"],
  viewport: { width: 390, height: 844 },
});

console.log(`\nentry paths against ${BASE}`);

// -- 1. The site's front door -----------------------------------------------------
step(1, "Land on / — should land on the order page");
{
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/order/, { timeout: 15_000 }).catch(() => {});
  await settle(page);
  check(
    "/ redirects to the order page",
    page.url().includes("/order"),
    page.url(),
  );
  check("asks the customer to scan", (await classify(page)) === "scan prompt");
  check("no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// -- 2. No table buttons ------------------------------------------------------
// The front door used to be a grid of table numbers. Any link to a table from
// here would skip the table's code, so there must be none.
step(2, "The scan prompt offers no table buttons");
{
  const page = await context.newPage();
  await page.goto(`${BASE}/order`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const tiles = await page.locator('a[href*="table="]').count();
  check("no tappable tables", tiles === 0, `${tiles} found`);
  check(
    "tells the customer where to get help",
    /ask at the counter/i.test(await page.locator("body").innerText()),
  );
  await page.close();
}

// -- 3. The QR code path ----------------------------------------------------------
// The same destination, reached the way a scanned code reaches it: a full page
// load. Kept as a separate case because it is the one that always worked, and the
// contrast between 2 and 3 is what identifies the fault.
step(3, "Open /order?table=3 directly — the QR path");
// Both shapes of QR link: an old card (no code) and a new one (with a code).
// The menu opens either way; whether the order is then accepted is the rules'
// decision (scripts/rules-test.mjs), and on a fresh build no table has a code.
for (const query of ["?table=3", "?table=3&k=PrintedCode12"]) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/order${query}`, { waitUntil: "domcontentloaded" });
  await waitForMenu(page);
  await settle(page);
  const shown = await classify(page);
  console.log(`  ${query} shows: ${shown}`);
  check(`${query} shows the menu`, shown === "menu", `got "${shown}"`);
  // The code is saved on the phone and never left in the address.
  check(
    `${query} leaves no code in the address`,
    new URL(page.url()).search === "?table=3",
    page.url(),
  );
  check("no console errors", errors.length === 0, errors.join("; "));
  await page.close();
}

// -- 4. Bad and missing table numbers --------------------------------------------
step(4, "Odd table numbers should land on the scan prompt, not break");
// Anything with a table-ish value that is not a real table gets the "looks odd"
// screen. A missing value gets the plain scan prompt, because there is nothing
// to be surprised about.
for (const [query, why, want] of [
  ["?table=99", "a table this cafe does not have", "odd-table notice"],
  ["?table=abc", "not a number", "odd-table notice"],
  ["?table=0", "zero", "odd-table notice"],
  ["?table=-2", "negative", "odd-table notice"],
  ["", "no table at all", "scan prompt"],
]) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/order${query}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const shown = await classify(page);
  check(
    `${why} (${query || "no query"}) falls back cleanly`,
    shown === want,
    `got "${shown}", wanted "${want}"`,
  );
  check(`  ...and does not throw`, errors.length === 0, errors.join("; "));
  await page.close();
}

await browser.close();
if (dev) dev.kill("SIGKILL");

console.log(
  failures === 0
    ? "\nentry: all checks passed"
    : `\nentry: ${failures} check(s) failed`,
);
process.exit(failures ? 1 : 0);

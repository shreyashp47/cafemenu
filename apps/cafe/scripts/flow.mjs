/**
 * Dev-only end-to-end walkthrough of the flows that matter:
 * owner creates table codes and turns "Approve new tables" on (it is off by
 * default) -> a typed-in address is turned away -> customer
 * places an order from the QR link -> it waits for the counter (a new guest)
 * -> staff accept it on the board, which opens the table -> staff advance the
 * status -> the customer's screen reflects it without a refresh -> a second
 * order from the open table goes straight to the kitchen -> staff close the
 * table -> the next order waits again and staff reject it -> with the owner's
 * "Approve new tables" switch off again, orders skip the wait.
 *
 * Runs against `next dev` (or BASE_URL) in demo mode, where "live" is
 * localStorage + BroadcastChannel. Also fails on any console error.
 *
 *   npm run flow                 # same as: node scripts/flow.mjs
 *
 * DEMO MODE ONLY. It signs in to the staff board with the demo PIN and places a
 * real order, so never set BASE_URL to the live site (toe-cafe.web.app), and
 * move a .env.local with real Firebase keys aside first: the `next dev` this
 * starts reads it, and the order would land in the real project.
 */
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, devices } from "playwright";

const OUT = ".screenshots/flow";
const PORT = 4311;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
let failures = 0;

function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up */
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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// One context, two pages: this is what makes demo-mode "live" work, and it is
// also exactly how a real customer + staff pair behaves.
const context = await browserContext();
const errors = [];

async function browserContext() {
  return chromium.launch().then(async (browser) => {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    return ctx;
  });
}

function watch(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${tag}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  return page;
}

const customer = watch(await context.newPage(), "customer");
const staff = watch(await context.newPage(), "staff");

// --- 0. the owner turns on table codes ---------------------------------------
step(0, "Owner creates table codes on /admin/qr");
const owner = watch(await context.newPage(), "owner");
await owner.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await owner.getByRole("button", { name: "Fill owner" }).click();
await owner.getByRole("button", { name: "Sign in" }).click();
await owner.waitForURL(/\/admin/, { timeout: 20_000 });
await owner.goto(`${BASE}/admin/qr`, { waitUntil: "networkidle" });
await owner
  .getByRole("button", { name: "Create codes for all tables" })
  .click();
await owner.getByText(/Every table has a code/).waitFor({ timeout: 10_000 });
const qrLink = (
  await owner
    .getByText(/\/order\?table=3&k=/)
    .first()
    .innerText()
).trim();
check(
  "table 3's card carries a code",
  /\/order\?table=3&k=[A-Za-z0-9]{12}$/.test(qrLink),
  qrLink,
);
await owner.screenshot({ path: `${OUT}/00-owner-qr-codes.png` });
const keyedPath = qrLink.replace(/^https?:\/\/[^/]+/, "");
// "Approve new tables" is off by default (every order goes straight to the
// kitchen). The owner turns it on from the dashboard for the steps below.
await owner.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
const approveSwitch = owner.getByRole("switch", {
  name: /Approve new tables/,
});
await approveSwitch.waitFor({ timeout: 10_000 });
check(
  "'Approve new tables' is on the dashboard, off by default",
  (await approveSwitch.getAttribute("aria-checked")) === "false",
);
await approveSwitch.click();
await owner.waitForFunction(
  () =>
    [...document.querySelectorAll("[role=switch]")].some(
      (el) =>
        /Approve new tables/.test(el.textContent ?? "") &&
        el.getAttribute("aria-checked") === "true",
    ),
  undefined,
  { timeout: 10_000 },
);
await owner.screenshot({ path: `${OUT}/00b-owner-approve-on.png` });
// Sign out, so the staff page below starts from its own sign-in.
await owner.getByRole("button", { name: "Sign out" }).click();
await owner.close();

// --- 1. customer browses and adds items -------------------------------------
step("1a", "A typed-in address, without the code, is turned away at checkout");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await customer.waitForSelector("li", { timeout: 30_000 });
await customer
  .locator("li", { hasText: "Cappuccino" })
  .getByRole("button", { name: /^Add$/ })
  .first()
  .click();
await customer.getByRole("button", { name: /View order/ }).click();
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer
  .getByText("To order, please scan the QR code on your table.")
  .waitFor({ timeout: 10_000 });
check("told to scan the QR code instead", true);
await customer.screenshot({ path: `${OUT}/01a-keyless-refused.png` });
// Empty the basket again so the counts below start from nothing.
await customer.getByRole("button", { name: "Remove", exact: true }).click();

step(1, "Customer opens the table QR link");
await customer.goto(`${BASE}${keyedPath}`, { waitUntil: "networkidle" });
await customer.waitForURL((u) => !u.searchParams.has("k"), { timeout: 5_000 });
check(
  "the code leaves the address bar at once, the table stays",
  new URL(customer.url()).search === "?table=3",
  customer.url(),
);
check(
  "table number shown in header",
  await customer.getByText("3", { exact: true }).first().isVisible(),
);

step(2, "Customer adds two different items");
// Target by name, not index: adding the first item turns its "Add" button into a
// stepper, which shifts the index of every button after it.
const addByName = async (page, name) => {
  const button = page
    .locator("li", { hasText: name })
    .getByRole("button", { name: /^Add$/ })
    .first();
  // The cart trigger is a fixed bottom bar, so a card scrolled to the very
  // bottom of the viewport sits underneath it. Centre the target first.
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await button.waitFor({ state: "visible" });
  await button.click();
};

/** Same, but for the +/- stepper that replaces the Add button. */
const stepper = async (page, ariaLabel) => {
  const button = page
    .getByRole("button", { name: ariaLabel, exact: true })
    .first();
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await button.waitFor({ state: "visible" });
  await button.click();
};

await customer.waitForSelector("li", { timeout: 30_000 });
await addByName(customer, "Cappuccino");
await addByName(customer, "Butter Scone");
// Once an item is in the cart its Add button becomes a stepper — use it, which
// is also what exercises the "Add one more …" control.
await stepper(customer, "Add one more Butter Scone");
await customer.waitForTimeout(300);
check(
  "cart trigger shows 3 items",
  (
    await customer.getByRole("button", { name: /View order/ }).innerText()
  ).includes("3"),
);
await customer.screenshot({
  path: `${OUT}/01-menu-with-cart.png`,
  fullPage: false,
});

step(3, "Customer opens the cart sheet");
await customer.getByRole("button", { name: /View order/ }).click();
await customer.waitForTimeout(500);
check("sheet is a dialog", await customer.getByRole("dialog").isVisible());
check(
  "place order is disabled before consent",
  await customer.getByRole("button", { name: /Place order/ }).isDisabled(),
);
await customer.screenshot({ path: `${OUT}/02-cart-sheet.png` });

step(4, "Customer consents and places the order");
await customer.getByRole("checkbox").check();
await customer.getByRole("button", { name: /Place order/ }).click();
await customer.waitForURL(/\/order\/confirmation/, { timeout: 20_000 });
check(
  "landed on the confirmation screen",
  /\/order\/confirmation/.test(customer.url()),
);
check(
  "the confirmation address carries no code",
  !new URL(customer.url()).searchParams.has("k"),
  customer.url(),
);
await customer
  .getByRole("heading", {
    name: "Waiting for the counter to confirm your table",
  })
  .waitFor({ timeout: 10_000 });
check("a new guest's first order waits for the counter", true);
// A waiting order has no number yet, and the screen must not show a stand-in
// that would change: the number comes once staff accept it (daily numbers).
check(
  "the waiting screen shows no order number",
  !/#\d/.test(await customer.locator("body").innerText()),
);
await customer.screenshot({
  path: `${OUT}/03-confirmation.png`,
  fullPage: true,
});
const orderUrl = customer.url();

// --- 2. staff board receives it live -----------------------------------------
step(5, "Staff signs in and sees the order without refreshing");
await staff.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await staff
  .getByRole("button", { name: "PIN" })
  .click()
  .catch(() => {});
await staff.getByPlaceholder("••••").fill("1122");
await staff.getByRole("button", { name: "Sign in" }).click();
await staff.waitForSelector("text=Order board", { timeout: 20_000 });
check(
  "table 3 ticket is on the board",
  (await staff
    .getByText("Table 3")
    .first()
    .isVisible()
    .catch(() => false)) ||
    (await staff.locator("main").innerText()).includes("3"),
);
check(
  "board lists the ordered item",
  (await staff.locator("main").innerText()).includes("Cappuccino"),
);
check(
  "it is in the New guests section",
  await staff
    .getByRole("region", { name: "New guests — check the table" })
    .isVisible(),
);
// The board numbers every order it sees, but not one still waiting for the
// counter: a stranger's order that gets turned away never uses up a number.
await staff.waitForTimeout(1500);
check(
  "the board does not number a new guest before Accept",
  !(await staff.locator("main").innerText()).includes("#0001"),
);
await staff.screenshot({ path: `${OUT}/04-staff-board.png`, fullPage: true });

step("5b", "Staff accept the new guest; the table opens");
await staff.getByRole("button", { name: "Accept" }).click();
await staff.locator("[data-open-table='3']").waitFor({ timeout: 10_000 });
check("table 3 is in Open tables", true);
await customer.waitForFunction(
  () => document.body.innerText.includes("Being made right now."),
  undefined,
  { timeout: 20_000 },
);
check("customer moved on to Preparing by itself", true);
await staff.waitForFunction(
  () => document.querySelector("main")?.innerText.includes("#0001"),
  undefined,
  { timeout: 10_000 },
);
check(
  "once accepted, the board gives it today's first number, #0001",
  (await staff.locator("main").innerText()).includes("#0001"),
);
await customer.waitForFunction(
  () => document.body.innerText.includes("#0001"),
  undefined,
  { timeout: 10_000 },
);
check(
  "the customer's screen shows #0001 live",
  (await customer.locator("body").innerText()).includes("Order #0001"),
);
await staff.screenshot({
  path: `${OUT}/04b-staff-accepted.png`,
  fullPage: true,
});

step(6, "Staff marks it ready");
await staff.getByRole("button", { name: "Mark ready" }).click();
await staff.waitForTimeout(900);
check(
  "badge now reads Ready",
  (await staff.locator("main").innerText()).includes("Ready"),
);

// --- 3. customer sees it live ------------------------------------------------
step(7, "Customer screen reflects the change with no refresh");
await customer.waitForFunction(
  () => document.body.innerText.includes("Ready — a barista"),
  undefined,
  { timeout: 20_000 },
);
check("customer timeline advanced to Ready", true);
await customer.screenshot({
  path: `${OUT}/05-customer-ready.png`,
  fullPage: true,
});

step(8, "Staff serves then completes; ticket leaves the board");
await staff.getByRole("button", { name: "Mark served" }).click();
await staff.waitForTimeout(600);
await staff.getByRole("button", { name: "Complete" }).click();
await staff.waitForTimeout(1200);
check(
  "board is empty after completing",
  (await staff.locator("main").innerText()).includes("All caught up"),
);
await staff.screenshot({ path: `${OUT}/06-staff-empty.png`, fullPage: true });

step(9, "Reload keeps the customer on their live order");
await customer.goto(orderUrl, { waitUntil: "networkidle" });
await customer.waitForTimeout(1200);
check(
  "reload still shows the order",
  (await customer.locator("main").innerText()).includes("Order"),
);

// --- 4. cart persistence -----------------------------------------------------
step(10, "A second order from the open table goes straight to the kitchen");
// The phone's own 30-second throttle note, not the thing under test here.
const forgetThrottle = () =>
  customer.evaluate(() => localStorage.removeItem("toe.lastOrderAt"));
const orderOne = async (name) => {
  await forgetThrottle();
  // Keyless address: the phone remembers the code from the scan.
  await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
  await addByName(customer, name);
  await customer.getByRole("button", { name: /View order/ }).click();
  await customer.getByRole("checkbox").check();
  await customer.getByRole("button", { name: /Place order/ }).click();
  await customer.waitForURL(/\/order\/confirmation/, { timeout: 20_000 });
};
await orderOne("Masala Chai");
await customer.getByText("Got it!").waitFor({ timeout: 10_000 });
check("no waiting on an open table", true);
await staff
  .getByRole("button", { name: "Mark ready" })
  .waitFor({ timeout: 10_000 });
check(
  "and it is kitchen work on the board, not a new guest",
  !(await staff
    .getByRole("region", { name: "New guests — check the table" })
    .isVisible()
    .catch(() => false)),
);
await customer.waitForFunction(
  () => document.body.innerText.includes("#0002"),
  undefined,
  { timeout: 10_000 },
);
check(
  "with the board open, the next order is #0002 straight away",
  (await customer.locator("body").innerText()).includes("Order #0002"),
);

step("10a", "On a freshly opened board, the very first tap still works");
// The first tap anywhere switches the order sound on. It used to also change
// the height of the "Tap anywhere…" line (removed, and later a shorter line
// that wrapped less at large text sizes), which moved the board up under the
// finger between press and release, so the first Accept or Mark ready did
// nothing.
const ASK = "Tap anywhere to switch the order sound on.";
const ON = "Order sound on.";
{
  const fresh = watch(await context.newPage(), "fresh-board");
  await fresh.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
  const ready = fresh.getByRole("button", { name: "Mark ready" });
  await ready.waitFor({ timeout: 20_000 });
  check(
    "the fresh board asks for a tap to switch the sound on",
    await fresh.getByText(ASK, { exact: true }).isVisible(),
  );
  await ready.click(); // once, and never again
  const took = await fresh
    .getByRole("button", { name: "Mark served" })
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check("one tap on Mark ready marked it ready", took);
  await fresh
    .getByText(ON, { exact: true })
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  check(
    "and the sound line stayed, now saying it is on",
    (await fresh.getByText(ON, { exact: true }).isVisible()) &&
      !(await fresh.getByText(ASK, { exact: true }).isVisible()),
  );
  await fresh.close();
}

step(
  "10a2",
  "At 390px and 200% text, a slow first tap does not move the ticket",
);
// Large text wraps the longer wording onto more lines than the shorter one,
// so this is where a height change would show. The finger rests for a moment
// before lifting, which gives the page time to re-render mid-tap, and it lands
// near the bottom edge of the button, where a jump would miss it.
{
  const big = watch(await context.newPage(), "fresh-board-200");
  await big.setViewportSize({ width: 390, height: 2000 });
  await big.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
  await big.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const served = big.getByRole("button", { name: "Mark served" });
  await served.waitFor({ timeout: 20_000 });
  check(
    "the fresh board asks for a tap to switch the sound on",
    await big.getByText(ASK, { exact: true }).isVisible(),
  );
  await served.evaluate((el) => {
    // Tap from the top of the page, with no scrolling: once scrolled, the
    // browser's scroll anchoring can hide a jump that a board opened at the
    // top (the usual case) would show. The tall viewport keeps the ticket on
    // screen at 200% text.
    window.scrollTo({ top: 0, behavior: "instant" });
    const ticket = el.closest("[role=listitem]");
    const top = () => ticket.getBoundingClientRect().top;
    window.__tapTops = [];
    window.addEventListener("pointerdown", () => window.__tapTops.push(top()), {
      capture: true,
      once: true,
    });
    window.addEventListener("pointerup", () => window.__tapTops.push(top()), {
      capture: true,
      once: true,
    });
  });
  await big.waitForTimeout(300);
  const box = await served.boundingBox();
  check(
    "the ticket is on screen with the page at the top",
    (await big.evaluate(() => window.scrollY)) === 0 &&
      box.y + box.height <= 2000,
    JSON.stringify(box),
  );
  await big.mouse.move(box.x + box.width / 2, box.y + box.height - 3);
  await big.mouse.down();
  await big.waitForTimeout(400); // the sound switches on here, mid-tap
  await big.mouse.up();
  const tops = await big.evaluate(() => window.__tapTops);
  check(
    "the ticket did not move between press and release",
    tops.length === 2 && tops[0] === tops[1],
    JSON.stringify(tops),
  );
  const took = await big
    .getByRole("button", { name: "Complete" })
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check("one tap on Mark served marked it served", took);
  check(
    "and the line now says the sound is on",
    await big.getByText(ON, { exact: true }).isVisible(),
  );
  await big.close();
}
await staff
  .getByRole("button", { name: "Complete" })
  .waitFor({ timeout: 10_000 });
await staff.getByRole("button", { name: "Complete" }).click();
await staff.waitForTimeout(600);

step("10b", "Staff close table 3; the next order waits again");
await staff.getByRole("button", { name: "Close table 3" }).click();
check("Close asks first", await staff.getByText("Close table 3?").isVisible());
await staff.getByRole("button", { name: "Close table", exact: true }).click();
await staff
  .locator("[data-open-table='3']")
  .waitFor({ state: "detached", timeout: 10_000 });
check("table 3 left Open tables", true);
await orderOne("Masala Chai");
await customer
  .getByText("Waiting for the counter to confirm your table")
  .waitFor({ timeout: 10_000 });
check("the next order waits for the counter", true);
await staff.waitForTimeout(1500);
check(
  "and the board leaves it unnumbered",
  !(await staff.locator("main").innerText()).includes("#0003"),
);

step("10c", "Staff reject it: nobody at the table; the customer is told");
await staff.getByRole("button", { name: /^Reject order #/ }).click();
check(
  "reject asks on the ticket first",
  await staff.getByText(/^Reject order #\d+ from table 3\?$/).isVisible(),
);
check(
  "'No one at this table' is already picked for a new guest",
  (await staff
    .getByRole("button", { name: "No one at this table" })
    .getAttribute("aria-pressed")) === "true",
);
await staff.screenshot({ path: `${OUT}/07-staff-reject-confirm.png` });
await staff.getByRole("button", { name: "Reject order" }).click();
await staff.waitForTimeout(900);
check(
  "rejected ticket leaves the board",
  (await staff.locator("main").innerText()).includes("All caught up"),
);
await customer.waitForFunction(
  () => document.body.innerText.includes("couldn't accept this order"),
  undefined,
  { timeout: 20_000 },
);
check(
  "customer sees the reason",
  (await customer.locator("main").innerText()).includes("No one at this table"),
);
await customer.screenshot({
  path: `${OUT}/08-customer-rejected.png`,
  fullPage: true,
});

step("10d", "The owner switches approval off; orders skip the wait");
// Demo sessions are shared by every tab, so the barista signs out first.
await staff.getByRole("button", { name: "Sign out" }).click();
const owner2 = watch(await context.newPage(), "owner");
await owner2.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await owner2.getByRole("button", { name: "Fill owner" }).click();
await owner2.getByRole("button", { name: "Sign in" }).click();
await owner2.waitForURL(/\/admin/, { timeout: 20_000 });
await owner2.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
const guestSwitch = owner2.getByRole("switch", {
  name: /Approve new tables/,
});
await guestSwitch.waitFor({ timeout: 10_000 });
check(
  "the switch is still on from step 0",
  (await guestSwitch.getAttribute("aria-checked")) === "true",
);
await guestSwitch.click();
await owner2.waitForFunction(
  () =>
    [...document.querySelectorAll("[role=switch]")].some(
      (el) =>
        /Approve new tables/.test(el.textContent ?? "") &&
        el.getAttribute("aria-checked") === "false",
    ),
  undefined,
  { timeout: 10_000 },
);
await owner2.screenshot({ path: `${OUT}/09-owner-switch-off.png` });
await orderOne("Butter Scone");
await customer.getByText("Got it!").waitFor({ timeout: 10_000 });
check("with the switch off, a closed table's order skips the wait", true);
// Left off: that is the default, and each run starts a fresh browser context.
await owner2.close();

step("10e", "A code scanned over 3 hours ago asks for a new scan");
// Wind this phone's scan time back 3h01 rather than waiting.
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await customer.evaluate(() => {
  const key = "toe.tableKey.t3";
  const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
  saved.at = Date.now() - (3 * 60 + 1) * 60_000;
  localStorage.setItem(key, JSON.stringify(saved));
});
await customer.reload({ waitUntil: "networkidle" });
await customer
  .getByText(/scan the QR code on your table again/)
  .first()
  .waitFor({ timeout: 10_000 });
check("the menu asks for a new scan", true);
await addByName(customer, "Masala Chai");
await customer.getByRole("button", { name: /View order/ }).click();
await customer.getByRole("checkbox").check();
check(
  "place order stays off until they scan again",
  await customer.getByRole("button", { name: /Place order/ }).isDisabled(),
);
await customer.screenshot({ path: `${OUT}/09-code-expired.png` });
await customer.getByRole("button", { name: "Remove", exact: true }).click();
// Scanning the card again restarts the 3 hours.
await customer.goto(`${BASE}${keyedPath}`, { waitUntil: "networkidle" });
await customer.waitForURL((u) => !u.searchParams.has("k"), { timeout: 5_000 });
check(
  "a new scan clears the notice",
  !(await customer
    .getByText(/scan the QR code on your table again/)
    .first()
    .isVisible()
    .catch(() => false)),
);

step("10f", "The tab the scan opened asks again after 3 hours, no reload");
// The tab most customers keep: opened by the camera with ?k=, never reloaded.
// Unit tests stand in for Next's router, so only a real browser shows whether
// the router let go of the scanned code when it left the address bar.
{
  const scanned = watch(await context.newPage(), "scanned-tab");
  await scanned.clock.install();
  await scanned.goto(`${BASE}${keyedPath}`, { waitUntil: "networkidle" });
  await scanned.waitForURL((u) => !u.searchParams.has("k"), {
    timeout: 5_000,
  });
  const notice = () =>
    scanned
      .getByText(/scan the QR code on your table again/)
      .first()
      .isVisible()
      .catch(() => false);
  await scanned.clock.fastForward("02:59:00");
  await scanned.waitForTimeout(300);
  check("no notice at 2h59", !(await notice()));
  await scanned.clock.fastForward("00:02:00");
  await scanned.waitForTimeout(500);
  check("the notice appears at 3h01 on its own", await notice());
  await scanned.screenshot({ path: `${OUT}/10-scanned-tab-expired.png` });
  await scanned.close();
}

step(11, "Cart survives a reload");
await customer.goto(`${BASE}/order?table=3`, { waitUntil: "networkidle" });
await addByName(customer, "Masala Chai");
await customer.reload({ waitUntil: "networkidle" });
await customer.waitForTimeout(600);
check(
  "cart persisted across reload",
  await customer.getByRole("button", { name: /View order/ }).isVisible(),
);

await context.close();

const unique = [...new Set(errors)];
if (unique.length) {
  console.log(`\n--- ${unique.length} console error(s) ---`);
  for (const e of unique) console.log(e);
  failures += unique.length;
}
if (dev) dev.kill("SIGTERM");

console.log(
  failures === 0
    ? "\nflow: all checks passed"
    : `\nflow: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);

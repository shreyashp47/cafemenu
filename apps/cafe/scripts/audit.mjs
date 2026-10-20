/**
 * Dev/CI-only accessibility + engine audit.
 *
 * Two things a unit test and a Chromium screenshot cannot tell you:
 *
 *  1. whether the screens are actually usable in **WebKit** (Safari / iOS),
 *     which is a large share of cafe customers and the only way to honour the
 *     "must work on standard Android/iOS mobile browsers" requirement;
 *  2. whether the rendered DOM has WCAG A/AA problems — colour contrast, names,
 *     roles, landmark structure.
 *
 * Fails on: any console error, any horizontal overflow, any WCAG A/AA violation,
 * and any route that fails to render in WebKit.
 *
 *   npm run audit                          # this script; NOT `npm audit`
 *   npm run audit -- --engine=webkit       # iOS/Safari only
 *   BASE_URL=http://127.0.0.1:4320 npm run audit   # against `npm run preview`
 *
 * Starts `next dev` unless BASE_URL is set; CI points it at the served build.
 * Staff and owner screens are reached by planting a demo-mode session in
 * localStorage, so against a Firebase-configured build (the live site) they
 * only show the sign-in screen. Needs `npx playwright install chromium webkit`.
 */
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, webkit, devices } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const OUT = ".screenshots/audit";
const PORT = 4321;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const onlyEngine = process.argv
  .find((a) => a.startsWith("--engine="))
  ?.split("=")[1];

const SESSION_KEY = "cafe-qr-order.session.v1";
const SESSIONS = {
  staff: {
    uid: "demo-staff",
    email: "staff@demo.cafe",
    role: "staff",
    displayName: "Barista",
  },
  owner: {
    uid: "demo-owner",
    email: "owner@demo.cafe",
    role: "owner",
    displayName: "Cafe Owner",
  },
};

const ROUTES = [
  { path: "/order?table=3", name: "order" },
  { path: "/order/confirmation?table=3", name: "confirmation" },
  { path: "/staff", name: "staff", auth: "staff" },
  { path: "/admin", name: "admin", auth: "owner" },
  { path: "/admin/reports", name: "reports", auth: "owner" },
  { path: "/admin/orders", name: "history", auth: "owner" },
  { path: "/admin/qr", name: "qr", auth: "owner" },
  { path: "/offline", name: "offline" },
];

// iPhone 13 is the closest thing to "a customer's phone" available here.
const VIEWPORT = { width: 390, height: 844 };

const problems = [];
const note = (engine, route, msg) =>
  problems.push(`[${engine}/${route}] ${msg}`);

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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const engines = [
  { name: "chromium", type: chromium },
  { name: "webkit", type: webkit },
].filter((e) => !onlyEngine || e.name === onlyEngine);

for (const { name, type } of engines) {
  console.log(`\n=== ${name} (iPhone-sized viewport) ===`);
  const browser = await type.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });

  for (const route of ROUTES) {
    // Collected per-attempt rather than noted immediately, so a page can be
    // reloaded once and a transient failure forgiven. A chunk that 404s or
    // times out is the network's fault, not the app's; anything else is still
    // fatal on the first attempt.
    let attemptErrors = [];
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") attemptErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => attemptErrors.push(`pageerror: ${e.message}`));

    if (route.auth) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [SESSION_KEY, JSON.stringify(SESSIONS[route.auth])],
      );
    }

    const open = async () => {
      attemptErrors = [];
      await page.goto(`${BASE}${route.path}`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await page.waitForTimeout(700);
    };
    await open();

    const TRANSIENT =
      /Loading chunk \d+ failed|Failed to fetch|net::ERR|NetworkError|504 asset unavailable/i;
    if (attemptErrors.length) {
      const onlyTransient = attemptErrors.every((e) => TRANSIENT.test(e));
      if (onlyTransient) {
        console.log(
          `  ..   ${route.name}: transient load failure, reloading once`,
        );
        await open();
        const survived = attemptErrors.filter((e) => TRANSIENT.test(e));
        if (survived.length) {
          console.log(
            `  ~~   ${route.name}: load still failing after a reload, reporting`,
          );
        } else {
          console.log(`  ok   ${route.name}: clean after reload`);
        }
      }
    }
    for (const e of attemptErrors) note(name, route.name, e);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1)
      note(name, route.name, `horizontal overflow +${overflow}px`);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    for (const v of violations) {
      const where = v.nodes[0]?.target?.join(" ") ?? "?";
      note(
        name,
        route.name,
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s), first: ${where}`,
      );
    }

    const ok = violations.length === 0 && overflow <= 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${route.name.padEnd(14)} ${
        violations.length
      } a11y violation(s)`,
    );
    if (name === "webkit") {
      await page.screenshot({ path: `${OUT}/${route.name}-webkit.png` });
    }
    await page.close();
  }

  await context.close();
  await browser.close();
}

if (dev) dev.kill("SIGTERM");

if (problems.length) {
  console.log(`\n--- ${problems.length} problem(s) ---`);
  for (const p of [...new Set(problems)]) console.log(p);
  process.exit(1);
}
console.log("\nno console errors, no overflow, no WCAG A/AA violations");

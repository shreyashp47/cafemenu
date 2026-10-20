/**
 * Dev-only visual smoke test: boots `next dev` (unless BASE_URL is provided),
 * walks the key screens at several phone widths plus one desktop width, and
 * writes PNGs to .screenshots/ so the UI can be eyeballed without a device.
 *
 *   node scripts/screenshot.mjs                     # all routes, all widths
 *   node scripts/screenshot.mjs /order              # one route
 *   node scripts/screenshot.mjs --quick             # 3 widths (what CI runs)
 *   BASE_URL=http://127.0.0.1:4320 node scripts/screenshot.mjs   # `npm run preview`
 *
 * Staff and owner screens are reached with a planted demo-mode session, so
 * against a Firebase-configured build (the live site) they show sign-in only.
 */
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium, devices } from "playwright";

const OUT = ".screenshots";
const PORT = 4310;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

const ALL_VIEWPORTS = [
  { name: "iphone-se", width: 320, height: 640, dpr: 2 },
  { name: "iphone-13", width: 390, height: 844, dpr: 3 },
  { name: "iphone-max", width: 430, height: 932, dpr: 3 },
  { name: "tablet", width: 768, height: 1024, dpr: 2 },
  { name: "desktop", width: 1280, height: 900, dpr: 2 },
];

// `--quick` drops the two widths that overlap, which is what CI needs to stay
// inside its time budget. Locally, run the full set.
const quick = process.argv.includes("--quick");
const VIEWPORTS = quick
  ? ALL_VIEWPORTS.filter((v) =>
      ["iphone-se", "iphone-13", "tablet"].includes(v.name),
    )
  : ALL_VIEWPORTS;

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/order?table=3", name: "order" },
  { path: "/order/confirmation?table=3", name: "confirmation" },
  { path: "/staff", name: "staff" },
  { path: "/admin", name: "admin", auth: "owner" },
  { path: "/admin/reports", name: "reports", auth: "owner" },
  { path: "/admin/orders", name: "history", auth: "owner" },
  { path: "/admin/qr", name: "qr", auth: "owner" },
  { path: "/offline", name: "offline" },
];

/** Seed the demo session so authenticated pages actually render. */
const DEMO_SESSION = {
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
const SESSION_KEY = "cafe-qr-order.session.v1";

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

function startDev() {
  const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.stderr.write(d));
  return child;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const known = ROUTES.filter((r) =>
  only.length === 0 ? true : only.includes(r.path.split("?")[0]),
);
// allow ad-hoc paths for spot checks, e.g. `node scripts/screenshot.mjs /__preview`
const routes = [
  ...known,
  ...only
    .filter((p) => !known.some((r) => r.path.split("?")[0] === p))
    .map((p) => ({
      path: p,
      name: p.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root",
    })),
];

const dev = process.env.BASE_URL ? null : startDev();
if (dev) {
  const ok = await waitForServer(BASE);
  if (!ok) {
    dev.kill("SIGKILL");
    console.error("dev server never came up");
    process.exit(1);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const consoleErrors = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.width < 768,
    hasTouch: vp.width < 768,
  });

  for (const route of routes) {
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[${route.name}/${vp.name}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(
        `[${route.name}/${vp.name}] pageerror: ${err.message}`,
      );
    });

    if (route.auth || route.name === "staff") {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [SESSION_KEY, JSON.stringify(DEMO_SESSION[route.auth ?? "staff"])],
      );
    }

    await page.goto(`${BASE}${route.path}`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });

    // Fill the demo store with a sample month so the reports screen shows real
    // figures. Done the way a user would: click the button it offers.
    if (route.name === "reports") {
      const seed = page.getByRole("button", { name: /Add a sample month/ });
      await seed.waitFor({ state: "visible", timeout: 20_000 });
      await seed.click();
      await page.waitForTimeout(1500);
    }

    await page.waitForTimeout(700);

    // Horizontal overflow is the #1 mobile-layout bug — assert it here.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) {
      consoleErrors.push(
        `[${route.name}/${vp.name}] horizontal overflow: +${overflow}px`,
      );
    }

    const file = `${OUT}/${route.name}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: vp.width < 768 });
    console.log(
      `shot ${file}${overflow > 1 ? `  (OVERFLOW +${overflow}px)` : ""}`,
    );
    await page.close();
  }
  await context.close();
}

await browser.close();
if (dev) dev.kill("SIGTERM");

if (consoleErrors.length) {
  console.log(`\n--- ${consoleErrors.length} problem(s) ---`);
  for (const e of [...new Set(consoleErrors)]) console.log(e);
  process.exit(1);
}
console.log("\nno console errors, no horizontal overflow");

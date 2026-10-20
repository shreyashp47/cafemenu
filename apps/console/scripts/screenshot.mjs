/**
 * Visual smoke test: every page of the console at phone, tablet and desktop
 * widths, full length, written to .screenshots/ so the layout can be looked at
 * without a device. Fails on horizontal overflow and on any console error.
 *
 *   npm run screenshot                                   # starts `next dev`
 *   BASE_URL=http://127.0.0.1:4330 npm run screenshot    # `npm run preview`
 *
 * Needs `npx playwright install chromium`. Look at the PNGs: overflow is the
 * only layout bug this can find on its own.
 */
import { mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright";
import { ROUTES, startServer } from "./lib/server.mjs";

const OUT = ".screenshots";
const VIEWPORTS = [
  { name: "iphone-se", width: 320, height: 640, dpr: 2 },
  { name: "iphone-13", width: 390, height: 844, dpr: 2 },
  { name: "tablet", width: 768, height: 1024, dpr: 2 },
  { name: "desktop", width: 1280, height: 900, dpr: 1 },
];

const { base, stop } = await startServer(4311);
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.width < 768,
    hasTouch: vp.width < 768,
  });
  for (const route of ROUTES) {
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") {
        problems.push(`[${route.name}/${vp.name}] console: ${m.text()}`);
      }
    });
    page.on("pageerror", (e) =>
      problems.push(`[${route.name}/${vp.name}] pageerror: ${e.message}`),
    );
    await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" });
    // Lazy screenshots load as they scroll into view; load them all first.
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll("img")) {
        img.loading = "eager";
      }
      await Promise.all(
        [...document.images].map((img) =>
          img.complete
            ? null
            : new Promise((r) =>
                img.addEventListener("load", r, { once: true }),
              ),
        ),
      );
    });
    // Against clientWidth, not innerWidth: on a phone (isMobile) the browser
    // widens the layout viewport to fit what overflows, so innerWidth grows
    // with the bug and the difference stays 0.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    if (overflow > 1) {
      problems.push(
        `[${route.name}/${vp.name}] horizontal overflow +${overflow}px`,
      );
    }
    const file = `${OUT}/${route.name}-${vp.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(
      `  shot ${file}${overflow > 1 ? `  (OVERFLOW +${overflow}px)` : ""}`,
    );
    await page.close();
  }
  await context.close();
}
await browser.close();
stop();

if (problems.length) {
  console.log(`\n--- ${problems.length} problem(s) ---`);
  for (const p of problems) console.log(p);
  process.exit(1);
}
console.log("\nno console errors, no horizontal overflow");

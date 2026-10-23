/**
 * Accessibility and engine audit, as in the cafe app: every page in Chromium
 * and in WebKit (Safari, iOS), at a phone width and a desktop width, checked
 * with axe against WCAG 2.1 A/AA, colour contrast included.
 *
 * Fails on any WCAG A/AA violation, any console error, and any horizontal
 * overflow.
 *
 *   npm run audit                                     # starts `next dev`
 *   npm run audit -- --engine=webkit                  # Safari only
 *   BASE_URL=http://127.0.0.1:4330 npm run audit      # `npm run preview`
 *
 * Needs `npx playwright install chromium webkit`.
 */
import { mkdir, rm } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { ROUTES, openRoute, startServer } from "./lib/server.mjs";

const OUT = ".screenshots/audit";
const onlyEngine = process.argv
  .find((a) => a.startsWith("--engine="))
  ?.split("=")[1];
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

const { base, stop } = await startServer(4321);
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const problems = [];
const engines = [
  { name: "chromium", type: chromium },
  { name: "webkit", type: webkit },
].filter((e) => !onlyEngine || e.name === onlyEngine);

for (const { name, type } of engines) {
  console.log(`\n=== ${name} ===`);
  const browser = await type.launch();
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    for (const route of ROUTES) {
      const where = `${name}/${vp.name}/${route.name}`;
      const page = await context.newPage();
      page.on("console", (m) => {
        if (m.type() === "error")
          problems.push(`[${where}] console: ${m.text()}`);
      });
      page.on("pageerror", (e) =>
        problems.push(`[${where}] pageerror: ${e.message}`),
      );
      await openRoute(page, base, route);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      if (overflow > 1)
        problems.push(`[${where}] horizontal overflow +${overflow}px`);

      // Every FAQ answer open, so their text is checked too.
      await page.evaluate(() => {
        for (const d of document.querySelectorAll("details")) d.open = true;
      });
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of violations) {
        const first = v.nodes[0]?.target?.join(" ") ?? "?";
        problems.push(
          `[${where}] ${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s), first: ${first}`,
        );
      }
      const ok = violations.length === 0 && overflow <= 1;
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${vp.name.padEnd(8)} ${route.name.padEnd(14)} ${violations.length} violation(s)`,
      );
      await page.screenshot({
        path: `${OUT}/${route.name}-${vp.name}-${name}.png`,
      });
      await page.close();
    }
    await context.close();
  }
  await browser.close();
}
stop();

if (problems.length) {
  console.log(`\n--- ${problems.length} problem(s) ---`);
  for (const p of [...new Set(problems)]) console.log(p);
  process.exit(1);
}
console.log("\nno console errors, no overflow, no WCAG A/AA violations");

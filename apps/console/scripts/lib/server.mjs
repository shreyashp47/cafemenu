/**
 * Shared by screenshot.mjs and audit.mjs: use BASE_URL if it is set (CI points
 * it at the served static export), otherwise start `next dev` on `port` and
 * wait for it.
 */
import { spawn } from "node:child_process";
import { applyDemoState } from "./demo-states.mjs";

export async function waitForServer(url, timeoutMs = 120_000) {
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

/** Resolves to { base, stop }. */
export async function startServer(port) {
  if (process.env.BASE_URL) {
    return { base: process.env.BASE_URL.replace(/\/$/, ""), stop: () => {} };
  }
  const base = `http://127.0.0.1:${port}`;
  const dev = spawn(
    "npx",
    ["next", "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (!(await waitForServer(base))) {
    dev.kill("SIGKILL");
    throw new Error("dev server never came up");
  }
  return { base, stop: () => dev.kill("SIGTERM") };
}

/**
 * Every page of the console, as served, and the states behind its steps:
 * `demo` names a state from demo-states.mjs to load first, and `act` does
 * something on the page before it is looked at.
 */
export const ROUTES = [
  { path: "/", name: "home" },
  { path: "/signup", name: "signup" },
  {
    path: "/signup",
    name: "signup-errors",
    // Sent empty: every field's problem is on show.
    act: async (page) => {
      await page.getByRole("button", { name: /create account/i }).click();
      await page.getByRole("alert").first().waitFor();
    },
  },
  {
    path: "/signup",
    name: "signup-accent",
    // An accent too light for the theme: the contrast guard's warning.
    act: async (page) => {
      await page.getByLabel("My own colour").check();
      await page.getByLabel("Colour code").fill("#F5B041");
      await page.getByText(/too light/i).waitFor();
    },
  },
  { path: "/signup", name: "signup-verify", demo: "verify" },
  { path: "/setup", name: "setup-signin" },
  { path: "/setup", name: "setup-project", demo: "project" },
  { path: "/setup", name: "setup-access", demo: "access" },
  { path: "/setup", name: "setup-connected", demo: "connected" },
];

/** Opens `route` in `page`: its demo state, the page, then its action. */
export async function openRoute(page, base, route) {
  await applyDemoState(page, route.demo);
  await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" });
  // The sign-up flow renders once the account state is known.
  await page.locator("main h1").first().waitFor();
  if (route.act) await route.act(page);
}

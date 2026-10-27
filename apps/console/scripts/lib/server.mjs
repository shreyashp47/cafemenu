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

/** Signs in as the demo's platform admin and waits for its cafes. */
async function signInAdmin(page) {
  await page.getByLabel("Email").fill("admin@cafemenu.demo");
  await page.getByLabel("Password").fill("demo-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByRole("heading", { name: "Owners and cafes", level: 1 })
    .waitFor();
  await page.getByRole("article").first().waitFor();
}

/** Signs in as the demo's admin and opens one sample cafe (#78). */
async function openSampleCafe(page) {
  await signInAdmin(page);
  await page
    .getByRole("button", { name: "Open Orchard Tea House (sample)" })
    .click();
  const history = page.getByRole("region", { name: "History" });
  await history.getByText(/Roll back to 1\.0\.0/).waitFor();
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
  { path: "/admin", name: "admin-signin" },
  // The demo's own admin, with its sample cafes in every state.
  { path: "/admin", name: "admin", act: signInAdmin },
  {
    path: "/admin",
    name: "admin-errors",
    // A release with nothing filled in: every field's problem is on show.
    act: async (page) => {
      await signInAdmin(page);
      await page.getByLabel("Version").fill("1.1.1");
      await page.getByRole("button", { name: /publish release/i }).click();
      await page.getByRole("alert").first().waitFor();
    },
  },
  // The super admin (#78): one cafe's history and actions.
  { path: "/admin", name: "admin-cafe", act: openSampleCafe },
  {
    path: "/admin",
    name: "admin-action-errors",
    // Maintenance asked for with nothing filled in, and an end before now.
    act: async (page) => {
      await openSampleCafe(page);
      await page.getByLabel("What to do").selectOption("maintenance-on");
      await page.getByRole("button", { name: "Turn maintenance on" }).click();
      await page.getByText("Pick a reason.").waitFor();
    },
  },
  {
    path: "/admin",
    name: "admin-delete",
    // Delete: the reminder, and a web address that doesn't match.
    act: async (page) => {
      await openSampleCafe(page);
      await page.getByLabel("What to do").selectOption("delete-owner");
      await page.getByLabel("Reason").selectOption("owner-request");
      await page
        .getByLabel("Type the cafe's web address to confirm")
        .fill("orchard");
      await page.getByRole("button", { name: "Delete for good" }).click();
      await page.getByText("That isn't this cafe's web address.").waitFor();
    },
  },
  {
    path: "/admin",
    name: "admin-bulk",
    // Two cafes picked for maintenance, and the form for both.
    act: async (page) => {
      await signInAdmin(page);
      await page
        .getByLabel("Select Harbour Beans (sample) for maintenance")
        .check();
      await page
        .getByLabel("Select The Lamp Room (sample) for maintenance")
        .check();
      await page
        .getByRole("button", { name: "Maintenance for the selected…" })
        .click();
      await page
        .getByRole("region", { name: "Maintenance on several cafes" })
        .waitFor();
    },
  },
  { path: "/setup", name: "setup-signin" },
  { path: "/setup", name: "setup-project", demo: "project" },
  { path: "/setup", name: "setup-access", demo: "access" },
  { path: "/setup", name: "setup-connected", demo: "connected" },
  { path: "/cafe", name: "cafe-signin" },
  { path: "/cafe", name: "cafe", demo: "owner" },
  { path: "/cafe", name: "cafe-running", demo: "ownerRunning" },
  {
    path: "/cafe",
    name: "cafe-errors",
    demo: "owner",
    // An empty name, and a currency changed without the box ticked.
    act: async (page) => {
      await page.getByLabel("Cafe name").fill("");
      await page.getByLabel("Currency").selectOption("USD");
      await page.getByRole("button", { name: /save and update/i }).click();
      await page.getByText("Give your cafe's name.").waitFor();
    },
  },
];

/** Opens `route` in `page`: its demo state, the page, then its action. */
export async function openRoute(page, base, route) {
  await applyDemoState(page, route.demo);
  await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" });
  // The sign-up flow renders once the account state is known.
  await page.locator("main h1").first().waitFor();
  if (route.act) await route.act(page);
}

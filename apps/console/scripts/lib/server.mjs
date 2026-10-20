/**
 * Shared by screenshot.mjs and audit.mjs: use BASE_URL if it is set (CI points
 * it at the served static export), otherwise start `next dev` on `port` and
 * wait for it.
 */
import { spawn } from "node:child_process";

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

/** Every page of the console, as served. */
export const ROUTES = [
  { path: "/", name: "home" },
  { path: "/signup", name: "signup" },
];

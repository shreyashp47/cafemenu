/**
 * scripts/lib/page-noise.mjs: the page checks forgive a demo's expected 404s
 * and WebKit's report of an abandoned Next.js prefetch, and nothing else.
 */
import { describe, expect, it } from "vitest";

import {
  isBootFileMiss,
  withoutAbortedPrefetches,
} from "../lib/page-noise.mjs";

// Verbatim from the failed run (39389049479).
const ABORTED =
  "pageerror: /127.0.0.1:4320/order.txt?_rsc=ZmCQ44b92m4mXe_R due to access control checks.";
const FELL_BACK =
  "console: Failed to fetch RSC payload for http://127.0.0.1:4320/order.txt. Falling back to browser navigation. TypeError: Load failed";

describe("withoutAbortedPrefetches", () => {
  it("drops the pair WebKit reports for an abandoned prefetch", () => {
    expect(withoutAbortedPrefetches("webkit", [ABORTED, FELL_BACK])).toEqual(
      [],
    );
  });

  it("keeps everything else that came with it", () => {
    const real = "pageerror: TypeError: undefined is not an object";
    expect(
      withoutAbortedPrefetches("webkit", [FELL_BACK, real, ABORTED]),
    ).toEqual([real]);
  });

  it("forgives nothing on Chromium, which never reports it", () => {
    expect(withoutAbortedPrefetches("chromium", [ABORTED, FELL_BACK])).toEqual([
      ABORTED,
      FELL_BACK,
    ]);
  });

  it("forgives neither message on its own", () => {
    expect(withoutAbortedPrefetches("webkit", [ABORTED])).toEqual([ABORTED]);
    expect(withoutAbortedPrefetches("webkit", [FELL_BACK])).toEqual([
      FELL_BACK,
    ]);
  });

  it("only pairs messages about the same router data", () => {
    const otherPage = FELL_BACK.replace("/order.txt", "/staff.txt");
    expect(withoutAbortedPrefetches("webkit", [ABORTED, otherPage])).toEqual([
      ABORTED,
      otherPage,
    ]);
  });

  it("does not stretch to other blocked requests", () => {
    const script =
      "pageerror: /127.0.0.1:4320/_next/static/chunks/app.js due to access control checks.";
    const firestore =
      "pageerror: https://firestore.googleapis.com/v1/x?_rsc=1 due to access control checks.";
    expect(
      withoutAbortedPrefetches("webkit", [script, firestore, FELL_BACK]),
    ).toEqual([script, firestore, FELL_BACK]);
  });
});

describe("isBootFileMiss", () => {
  // A Playwright ConsoleMessage, as far as the check reads one.
  const message = (text, url) => ({
    text: () => text,
    location: () => ({ url }),
  });
  const NOT_FOUND =
    "Failed to load resource: the server responded with a status of 404 (Not Found)";

  it("forgives the demo's 404 for init.json and for site.json", () => {
    expect(
      isBootFileMiss(
        message(NOT_FOUND, "http://127.0.0.1:4320/__/firebase/init.json"),
      ),
    ).toBe(true);
    expect(
      isBootFileMiss(message(NOT_FOUND, "http://127.0.0.1:4320/site.json")),
    ).toBe(true);
  });

  it("does not forgive a 404 for anything else", () => {
    for (const url of [
      "http://127.0.0.1:4320/_next/static/chunks/app.js",
      "http://127.0.0.1:4320/icon-192.png",
      "http://127.0.0.1:4320/admin/site.json",
      "",
    ]) {
      expect(isBootFileMiss(message(NOT_FOUND, url))).toBe(false);
    }
  });

  it("does not forgive those files failing any other way", () => {
    const url = "http://127.0.0.1:4320/site.json";
    for (const text of [
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: net::ERR_CONNECTION_REFUSED",
      "Uncaught TypeError: x is undefined",
    ]) {
      expect(isBootFileMiss(message(text, url))).toBe(false);
    }
  });
});

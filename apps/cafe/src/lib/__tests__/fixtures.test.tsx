/**
 * The fixture cafes in fixtures/ (issue #18). They stand in for real cafes in
 * CI, so they must be settings a real deploy would accept.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateCafeSettings } from "@cafemenu/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OrderPage from "@/app/order/page";
import { SUITE_FIXTURE, SUITE_SETTINGS } from "@/test/cafe";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const DIR = join(__dirname, "../../../fixtures");
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const read = (file: string): unknown =>
  JSON.parse(readFileSync(join(DIR, file), "utf8"));

describe("fixtures/", () => {
  it.each(fixtures)("%s passes the strict settings check", (file) => {
    expect(validateCafeSettings(read(file))).toMatchObject({ ok: true });
  });

  it("has TOE Cafe as TOE runs today", () => {
    expect(read("toe.json")).toMatchObject({
      name: "TOE Cafe",
      currency: "INR",
      locale: "en-IN",
      timeZone: "Asia/Kolkata",
      utcOffsets: { standard: 330, daylight: 330 },
      theme: "cozy",
      plan: "free",
    });
  });

  it.each(fixtures)("%s never prints QR cards for a real address", (file) => {
    // flow.mjs reads the printed card's address. A fixture must leave it to
    // the page it runs on, so no test ever reaches a live cafe.
    expect(read(file)).toMatchObject({ baseUrl: null });
  });
});

describe("the suite's cafe", () => {
  it("is the one CAFE_FIXTURE names, on every page", async () => {
    if (SUITE_FIXTURE === "toe") expect(SUITE_SETTINGS.name).toBe("TOE Cafe");
    window.history.replaceState({}, "", "/order?table=3");
    render(<OrderPage />);
    expect(
      await screen.findByRole("heading", { name: SUITE_SETTINGS.name }),
    ).toBeVisible();
    expect(screen.getByText(SUITE_SETTINGS.tagline)).toBeVisible();
  });
});

/**
 * One build, any cafe (issues #8 and #9): the same pages show whichever cafe's
 * settings the deploy and its config/site carry, and a real cafe that cannot
 * reach its config gets a retry screen instead of the demo store.
 *
 * Every test sets the boot itself with primeBoot, as the page would have
 * settled it from /__/firebase/init.json and /site.json (src/lib/boot.ts).
 */

import { DEFAULT_SETTINGS, type CafeSettings } from "@cafemenu/shared";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import QrPage from "@/app/admin/qr/page";
import OrderPage from "@/app/order/page";
import { CafeTitle, DEFAULT_TITLE, titleFor } from "@/components/CafeIdentity";
import { DataProvider } from "@/components/providers/DataProvider";
import { INIT_JSON_PATH, primeBoot, type Boot } from "@/lib/boot";
import { demoAuthRepo } from "@/lib/data/demo";
import { demoSetSite, resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { resetSettings } from "@/lib/settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/order",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const TOE: Partial<CafeSettings> = {
  name: "TOE Cafe",
  tagline: "Good Coffee, Better Days",
  tables: [1, 2, 3, 4, 5, 6, 7, 8],
  baseUrl: "https://toe.example",
};
const BERLIN: Partial<CafeSettings> = {
  name: "Kaffeehaus Mitte",
  tagline: "Seit 1998",
  currency: "EUR",
  locale: "de-DE",
  timeZone: "Europe/Berlin",
};

/** A preview deploy: demo store, with this cafe's site.json. */
function deployedAs(settings: Partial<CafeSettings>) {
  primeBoot({
    backend: { kind: "demo" },
    site: { status: "ok", value: { settings, demo: true } },
  });
  resetSettings();
}

function boot(result: Boot) {
  primeBoot(result);
  resetSettings();
}

beforeEach(async () => {
  resetDemoStore();
  await demoAuthRepo.signOut();
  window.history.replaceState({}, "", "/order?table=3");
});

afterEach(() => {
  vi.unstubAllGlobals();
  primeBoot({ backend: { kind: "demo" }, site: { status: "missing" } });
});

describe("the same build, two cafes", () => {
  it("shows each cafe its own name and tagline", async () => {
    deployedAs(TOE);
    const first = render(<OrderPage />);
    expect(
      await screen.findByRole("heading", { name: "TOE Cafe" }),
    ).toBeVisible();
    expect(screen.getByText("Good Coffee, Better Days")).toBeVisible();
    first.unmount();

    deployedAs(BERLIN);
    render(<OrderPage />);
    expect(
      await screen.findByRole("heading", { name: "Kaffeehaus Mitte" }),
    ).toBeVisible();
    expect(screen.getByText("Seit 1998")).toBeVisible();
    expect(screen.queryByText("TOE Cafe")).toBeNull();
  });

  it("is the demo cafe with no site.json, as on npm run dev", async () => {
    render(<OrderPage />);
    expect(
      await screen.findByRole("heading", { name: DEFAULT_SETTINGS.name }),
    ).toBeVisible();
    expect(screen.getByText(DEFAULT_SETTINGS.tagline)).toBeVisible();
  });

  it("takes its default tables from the settings", async () => {
    // Table 8 is outside the demo cafe's 1..6, and nobody has saved a list.
    deployedAs(TOE);
    window.history.replaceState({}, "", "/order?table=8");
    render(<OrderPage />);
    expect(
      await screen.findByRole("heading", { name: "TOE Cafe" }),
    ).toBeVisible();
    expect(screen.queryByText("That table number looks odd")).toBeNull();
  });

  it("follows config/site live, without a reload", async () => {
    deployedAs(TOE);
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "TOE Cafe" });
    act(() => demoSetSite({ name: "TOE Cafe & Bakery" }));
    expect(
      await screen.findByRole("heading", { name: "TOE Cafe & Bakery" }),
    ).toBeVisible();
    // The deploy-time tagline still stands under the live name.
    expect(screen.getByText("Good Coffee, Better Days")).toBeVisible();
  });
});

describe("a real cafe that cannot reach its Firebase config", () => {
  it("shows a retry screen, never the demo menu", () => {
    boot({
      backend: { kind: "unreachable", reason: "offline" },
      site: { status: "ok", value: { settings: TOE, demo: false } },
    });
    render(<OrderPage />);
    expect(
      screen.getByRole("heading", { name: "Can't reach the cafe" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    // Its own name from site.json, and nothing from the demo store.
    expect(screen.getByText("TOE Cafe")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
    expect(screen.queryByText(DEFAULT_SETTINGS.name)).toBeNull();
  });

  it("says so plainly when the deploy has no Firebase web app", () => {
    boot({
      backend: { kind: "unreachable", reason: "no-config" },
      site: { status: "ok", value: { settings: TOE, demo: false } },
    });
    render(<OrderPage />);
    expect(screen.getByRole("heading", { name: "Not open yet" })).toBeVisible();
  });

  it("tries again on a tap, and opens once the cafe answers", async () => {
    const user = userEvent.setup();
    boot({
      backend: { kind: "unreachable", reason: "offline" },
      site: { status: "error" },
    });
    // The retry finds a preview deploy: the demo store, so no SDK is needed.
    const fetchMock = vi.fn(async (path: string) =>
      path === INIT_JSON_PATH
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify({ ...TOE, demo: true }), {
            headers: { "content-type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPage />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "TOE Cafe" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/site.json",
      expect.objectContaining({ cache: "no-cache" }),
    );
  });

  it("tries again by itself when the device comes back online", async () => {
    boot({
      backend: { kind: "unreachable", reason: "offline" },
      site: { status: "error" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    render(<OrderPage />);
    expect(
      screen.getByRole("heading", { name: "Can't reach the cafe" }),
    ).toBeVisible();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(
      await screen.findByRole("heading", { name: DEFAULT_SETTINGS.name }),
    ).toBeVisible();
  });
});

describe("the owner's screens", () => {
  async function signInOwner() {
    await demoAuthRepo.signIn(
      DEMO_CREDENTIALS.owner.email,
      DEMO_CREDENTIALS.owner.password,
    );
  }

  it("names the cafe in the dashboard header", async () => {
    deployedAs(TOE);
    await signInOwner();
    render(
      <AdminLayout>
        <p>dashboard</p>
      </AdminLayout>,
    );
    expect(await screen.findByText("TOE Cafe")).toBeVisible();
  });

  it("prints QR cards for the cafe's own address, with its name", async () => {
    deployedAs(TOE);
    await signInOwner();
    render(
      <DataProvider>
        <QrPage />
      </DataProvider>,
    );
    expect(await screen.findByLabelText("Address to print")).toHaveValue(
      "https://toe.example",
    );
    expect(
      await screen.findByText("https://toe.example/order?table=8"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("TOE Cafe")).toHaveLength(8);
  });

  it("prints for the address the page is open on when the settings have none", async () => {
    await signInOwner();
    render(
      <DataProvider>
        <QrPage />
      </DataProvider>,
    );
    expect(await screen.findByLabelText("Address to print")).toHaveValue(
      window.location.origin,
    );
  });
});

describe("the tab title", () => {
  it("puts the name first on the default title, last on a page's own", () => {
    expect(titleFor(DEFAULT_TITLE, "TOE Cafe")).toBe(
      "TOE Cafe · Order from your table",
    );
    expect(titleFor("No connection", "TOE Cafe")).toBe(
      "No connection · TOE Cafe",
    );
    expect(titleFor("No connection", "")).toBe("No connection");
  });

  it("adds the cafe's name once its settings are known, and only once", async () => {
    document.title = DEFAULT_TITLE;
    deployedAs(TOE);
    const { rerender } = render(<CafeTitle />);
    await waitFor(() =>
      expect(document.title).toBe("TOE Cafe · Order from your table"),
    );
    expect(
      document
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
    ).toBe("TOE Cafe");

    // A new name replaces the old one rather than stacking on it.
    act(() => deployedAs({ ...TOE, name: "TOE Cafe & Bakery" }));
    rerender(<CafeTitle />);
    await waitFor(() =>
      expect(document.title).toBe("TOE Cafe & Bakery · Order from your table"),
    );
  });
});

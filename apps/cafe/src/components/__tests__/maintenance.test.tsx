/**
 * Maintenance mode on the cafe's own screens (#78), on the demo store: the
 * customer's "back soon" page in place of the menu, an order already placed
 * keeping its status screen, the staff board working on, the owner's own
 * switch, CafeMenu's maintenance that only CafeMenu can end, and a schedule
 * that starts and ends on time without a reload. What actually refuses an
 * order is the rules' inMaintenance(), tested in scripts/rules-test.mjs.
 */

import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import AdminMenuPage from "@/app/admin/page";
import OrderPage from "@/app/order/page";
import ConfirmationPage from "@/app/order/confirmation/page";
import StaffPage from "@/app/staff/page";
import { MaintenanceSetting } from "@/components/MaintenanceSetting";
import { DataProvider } from "@/components/providers/DataProvider";
import { useMaintenance } from "@/hooks/useMaintenance";
import { demoAuthRepo, demoConfigRepo, demoOrderRepo } from "@/lib/data/demo";
import {
  DemoRulesRefusal,
  demoSaveOwnerMaintenance,
  demoSetSite,
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import {
  MAINTENANCE_HELP_URL,
  resetMaintenance,
  setOwnerMaintenance,
  setSiteMaintenance,
} from "@/lib/maintenance";
import { forgetLastOrder } from "@/lib/order-throttle";
import { forgetTableKeys } from "@/lib/table-keys";
import { SUITE_SETTINGS } from "@/test/cafe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const HOUR = 3600_000;

beforeEach(async () => {
  resetDemoStore();
  resetMaintenance();
  forgetTableKeys();
  forgetLastOrder();
  localStorage.clear();
  await demoAuthRepo.signOut();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
});

/** CafeMenu's maintenance, as the deployer writes it into config/site. */
const adminMaintenance = (patch: Record<string, unknown> = {}) => ({
  maintenance: {
    on: true,
    by: "admin",
    message: "Back after a short update.",
    until: null,
    startsAt: null,
    endsAt: null,
    ...patch,
  },
});

const placeOrder = () => {
  demoSetTableOpenUntil(2, Date.now() + HOUR);
  return demoOrderRepo.create({
    tableNumber: 2,
    items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
    total: 200,
    status: "preparing",
  });
};

const signInOwner = () =>
  demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );

function openMenu(table = 2) {
  window.history.replaceState({}, "", `/order?table=${table}`);
  render(<OrderPage />);
}

describe("the customer's page", () => {
  it("shows the menu while the site is open", async () => {
    openMenu();
    expect(
      await screen.findByRole("heading", { name: SUITE_SETTINGS.name }),
    ).toBeVisible();
    expect(screen.queryByText("We'll be back soon")).toBeNull();
  });

  it("is the 'back soon' page in CafeMenu's maintenance: name, message, expected back", async () => {
    const back = Date.UTC(2026, 10, 3, 3, 30); // 09:00 in Kolkata
    demoSetSite(adminMaintenance({ until: new Date(back).toISOString() }));
    openMenu();
    expect(
      await screen.findByRole("heading", { name: "We'll be back soon" }),
    ).toBeVisible();
    expect(screen.getByText("Back after a short update.")).toBeVisible();
    expect(screen.getByText(SUITE_SETTINGS.name)).toBeVisible();
    expect(screen.getByText(/^Expected back .*9:00/)).toBeVisible();
    // No menu, so nothing to order from.
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("follows the setting live: on and off without a reload", async () => {
    openMenu();
    await screen.findByRole("heading", { name: SUITE_SETTINGS.name });
    act(() =>
      demoSaveOwnerMaintenance({
        ...adminMaintenance().maintenance,
        by: "owner",
        message: "",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "We'll be back soon" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "We're making a few changes, so ordering from your table is paused for now.",
      ),
    ).toBeVisible();
    act(() => demoSaveOwnerMaintenance(null));
    expect(
      await screen.findByRole("heading", { name: SUITE_SETTINGS.name }),
    ).toBeVisible();
  });

  it("refuses a new order in maintenance, as the rules do", async () => {
    demoSetSite(adminMaintenance());
    await expect(placeOrder()).rejects.toBeInstanceOf(DemoRulesRefusal);
    expect(loadDemoState().orders).toEqual([]);
  });

  it("keeps an order already placed on its live status screen", async () => {
    const order = await placeOrder();
    demoSetSite(adminMaintenance());
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=2&id=${order.id}`,
    );
    render(<ConfirmationPage />);
    expect(await screen.findByText("Being made right now.")).toBeVisible();
    expect(screen.queryByText("We'll be back soon")).toBeNull();
  });
});

describe("the staff board in maintenance", () => {
  it("says so, and still finishes the orders already placed", async () => {
    const user = userEvent.setup();
    await placeOrder();
    demoSetSite(adminMaintenance());
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);
    expect(
      await screen.findByText(
        /The site is in maintenance: customers can't order/,
      ),
    ).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(loadDemoState().orders[0].status).toBe("ready"));
  });

  it("shows no banner while the site is open", async () => {
    await placeOrder();
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);
    await screen.findByRole("button", { name: "Mark ready" });
    expect(screen.queryByText(/The site is in maintenance/)).toBeNull();
  });
});

describe("the owner's switch", () => {
  it("turns it on with a message, then off, from the dashboard", async () => {
    const user = userEvent.setup();
    await signInOwner();
    render(
      <AdminLayout>
        <AdminMenuPage />
      </AdminLayout>,
    );
    await user.type(
      await screen.findByLabelText("Message for customers"),
      "Closed for Diwali.",
    );
    await user.click(
      screen.getByRole("button", { name: "Turn maintenance on" }),
    );

    await waitFor(() =>
      expect(loadDemoState().ownerMaintenance).toMatchObject({
        on: true,
        by: "owner",
        message: "Closed for Diwali.",
      }),
    );
    expect(await screen.findByText("On now.")).toBeVisible();
    expect(
      screen.getByText(/Your site is in maintenance: customers see/),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Turn maintenance off" }),
    );
    await waitFor(() => expect(loadDemoState().ownerMaintenance).toBeNull());
    expect(
      await screen.findByRole("button", { name: "Turn maintenance on" }),
    ).toBeVisible();
    expect(screen.queryByText(/Your site is in maintenance/)).toBeNull();
  });

  it("schedules it in the cafe's time and says when it starts and ends", async () => {
    const user = userEvent.setup();
    await signInOwner();
    render(
      <DataProvider>
        <MaintenanceSetting />
      </DataProvider>,
    );
    await user.type(await screen.findByLabelText("Starts"), "2099-01-01T22:00");
    await user.type(
      screen.getByLabelText("Ends by itself"),
      "2099-01-02T08:00",
    );
    await user.click(
      screen.getByRole("button", { name: "Turn maintenance on" }),
    );

    await waitFor(() =>
      expect(loadDemoState().ownerMaintenance).toMatchObject({
        startsAt: new Date(Date.UTC(2099, 0, 1, 16, 30)).toISOString(),
        endsAt: new Date(Date.UTC(2099, 0, 2, 2, 30)).toISOString(),
      }),
    );
    expect(
      await screen.findByText(/^Starts .*10:00.*Ends .*8:00/),
    ).toBeVisible();
  });

  it("explains a wrong schedule instead of saving it", async () => {
    const user = userEvent.setup();
    await signInOwner();
    render(
      <DataProvider>
        <MaintenanceSetting />
      </DataProvider>,
    );
    await user.type(await screen.findByLabelText("Starts"), "2099-01-02T10:00");
    await user.type(
      screen.getByLabelText("Ends by itself"),
      "2099-01-02T09:00",
    );
    await user.click(
      screen.getByRole("button", { name: "Turn maintenance on" }),
    );
    expect(
      await screen.findByText("The end has to come after the start."),
    ).toBeVisible();
    expect(loadDemoState().ownerMaintenance).toBeNull();
  });

  it("is the owner's only: staff can't save it", async () => {
    await demoAuthRepo.signInWithPin("1122");
    await expect(
      demoConfigRepo.saveOwnerMaintenance({
        on: true,
        by: "owner",
        message: "",
        until: null,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toBeInstanceOf(DemoRulesRefusal);
  });
});

describe("CafeMenu's maintenance on the owner's dashboard", () => {
  it("says it's CafeMenu's, that only CafeMenu ends it, and how to after leaving", async () => {
    demoSetSite(adminMaintenance());
    await signInOwner();
    render(
      <AdminLayout>
        <AdminMenuPage />
      </AdminLayout>,
    );
    expect(
      await screen.findByText(/CafeMenu has put your site into maintenance/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "How to end it yourself" }),
    ).toHaveAttribute("href", MAINTENANCE_HELP_URL);
    // The owner's card says so, and offers nothing that would end it.
    expect(
      screen.getByText(/CafeMenu's own maintenance is on as well/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Turn maintenance off" }),
    ).toBeNull();
    // The dashboard itself keeps working: the menu is there to fix.
    expect(await screen.findByText(/12 items/)).toBeVisible();
  });

  it("says when CafeMenu's scheduled maintenance will start", async () => {
    demoSetSite(
      adminMaintenance({
        startsAt: new Date(Date.UTC(2099, 0, 1, 16, 30)).toISOString(),
      }),
    );
    await signInOwner();
    render(
      <AdminLayout>
        <p>dashboard</p>
      </AdminLayout>,
    );
    expect(
      await screen.findByText(
        /^CafeMenu will put your site into maintenance .*10:00/,
      ),
    ).toBeVisible();
  });

  it("leaves the owner's own off when CafeMenu ends theirs, and the other way round", async () => {
    demoSetSite(adminMaintenance());
    demoSaveOwnerMaintenance({
      ...adminMaintenance().maintenance,
      by: "owner",
    });
    openMenu();
    await screen.findByRole("heading", { name: "We'll be back soon" });
    act(() => demoSetSite(null));
    // Still the owner's.
    expect(
      await screen.findByRole("heading", { name: "We'll be back soon" }),
    ).toBeVisible();
    act(() => demoSaveOwnerMaintenance(null));
    expect(
      await screen.findByRole("heading", { name: SUITE_SETTINGS.name }),
    ).toBeVisible();
  });
});

describe("a schedule, without a reload", () => {
  it("starts and ends on time", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 4, 0) });
    const start = Date.now() + 10 * 60_000;
    const end = start + HOUR;
    const { result } = renderHook(() => useMaintenance());
    act(() =>
      setOwnerMaintenance({
        on: true,
        by: "owner",
        message: "",
        until: null,
        startsAt: new Date(start),
        endsAt: new Date(end),
      }),
    );
    expect(result.current.active).toBeNull();
    expect(result.current.owner?.startsAt).toBe(start);

    act(() => vi.advanceTimersByTime(10 * 60_000 + 100));
    expect(result.current.active?.by).toBe("owner");

    act(() => vi.advanceTimersByTime(HOUR));
    expect(result.current.active).toBeNull();
  });

  it("puts CafeMenu's first when both are on", () => {
    const { result } = renderHook(() => useMaintenance());
    act(() => {
      setOwnerMaintenance({ on: true, by: "owner", message: "Ours" });
      setSiteMaintenance({ on: true, by: "admin", message: "CafeMenu's" });
    });
    expect(result.current.active?.message).toBe("CafeMenu's");
    expect(result.current.admin?.by).toBe("admin");
    expect(result.current.owner?.by).toBe("owner");
  });
});

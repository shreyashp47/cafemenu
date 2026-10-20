/**
 * The screens around order abuse, run on the demo store: staff rejecting a
 * ticket (with an in-page confirmation, never window.confirm), the customer's
 * phone showing that plainly, and the owner creating and renewing table codes.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import QrPage from "@/app/admin/qr/page";
import ConfirmationPage from "@/app/order/confirmation/page";
import StaffPage from "@/app/staff/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { TableCodes } from "@/components/TableCodes";
import { demoAuthRepo, demoConfigRepo, demoOrderRepo } from "@/lib/data/demo";
import {
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(async () => {
  resetDemoStore();
  localStorage.clear();
  await demoAuthRepo.signOut();
});

// An order already in the kitchen: table 2 is open (staff confirmed it), so
// it arrives as `preparing`. New guests' `pending` orders have their own tests
// in new-guests.test.tsx.
const placeOrder = () => {
  demoSetTableOpenUntil(2, Date.now() + 3600_000);
  return demoOrderRepo.create({
    tableNumber: 2,
    items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
    total: 200,
    status: "preparing",
  });
};

describe("staff board: rejecting an order", () => {
  it("asks on the ticket itself, and Keep leaves the order alone", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    await placeOrder();
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Reject order #0001",
      }),
    );
    const panel = screen.getByRole("group", {
      name: "Reject order #0001 from table 2?",
    });
    expect(within(panel).getByText(/can.t be undone/)).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Keep order" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(loadDemoState().orders[0].status).toBe("preparing");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects with a picked reason, and the ticket leaves the board", async () => {
    const user = userEvent.setup();
    await placeOrder();
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Reject order #0001",
      }),
    );
    const reason = screen.getByRole("button", { name: "Duplicate order" });
    await user.click(reason);
    expect(reason).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Reject order" }));

    await waitFor(() =>
      expect(screen.getByText("All caught up")).toBeInTheDocument(),
    );
    expect(loadDemoState().orders[0]).toMatchObject({
      status: "rejected",
      rejectReason: "Duplicate order",
    });
  });

  it("does not offer Reject once the order is served", async () => {
    const order = await placeOrder();
    await demoOrderRepo.setStatus(order.id, "ready");
    await demoOrderRepo.setStatus(order.id, "served");
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);
    await screen.findByRole("button", { name: "Complete" });
    expect(screen.queryByRole("button", { name: /^Reject/ })).toBeNull();
  });
});

describe("customer's live status: a rejected order", () => {
  it("says the counter couldn't accept it, why, and where to go", async () => {
    const order = await placeOrder();
    await demoOrderRepo.reject(order.id, "No one at this table");
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=2&id=${order.id}`,
    );
    render(<ConfirmationPage />);

    expect(
      await screen.findByRole("heading", {
        name: "The counter couldn't accept this order",
      }),
    ).toBeVisible();
    expect(screen.getByText("No one at this table")).toBeVisible();
    expect(screen.getByText(/Please speak to the counter/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Order again" })).toBeNull();
  });

  it("changes live when staff reject it", async () => {
    const order = await placeOrder();
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=2&id=${order.id}`,
    );
    render(<ConfirmationPage />);
    await screen.findByText("Got it!");
    await demoOrderRepo.reject(order.id);
    expect(await screen.findByText(/couldn.t accept this order/)).toBeVisible();
    expect(screen.queryByText("Reason")).toBeNull();
  });
});

describe("owner: table codes panel", () => {
  it("offers to create codes for every table when none have one", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <TableCodes
        tables={[1, 2, 3]}
        keys={{}}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText(/anyone who knows your web address/)).toBeVisible();
    expect(screen.getByText(/replace the old ones/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Create codes for all tables" }),
    );
    expect(onCreate).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("names the tables still open, and creates only those", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <TableCodes
        tables={[1, 2, 3]}
        keys={{ 2: "HasCode1234" }}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText(/Tables 1, 3 have no code yet/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Create codes for 2 tables" }),
    );
    expect(onCreate).toHaveBeenCalledWith([1, 3]);
  });

  it("says so when every table is covered", () => {
    render(
      <TableCodes
        tables={[1]}
        keys={{ 1: "HasCode1234" }}
        loading={false}
        error={null}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Every table has a code",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("owner: /admin/qr with codes", () => {
  async function openQrPage() {
    await demoAuthRepo.signIn(
      DEMO_CREDENTIALS.owner.email,
      DEMO_CREDENTIALS.owner.password,
    );
    await demoConfigRepo.saveTables([1, 2]);
    render(
      <DataProvider>
        <QrPage />
      </DataProvider>,
    );
  }
  const urls = () =>
    screen.getAllByText(/\/order\?table=\d+/).map((el) => el.textContent ?? "");

  it("prints keyless links until codes exist, then keyed ones", async () => {
    const user = userEvent.setup();
    await openQrPage();
    await screen.findByRole("button", { name: "Create codes for all tables" });
    expect(urls().every((u) => !u.includes("&k="))).toBe(true);
    expect(screen.getAllByText("No code yet")).toHaveLength(2);

    await user.click(
      screen.getByRole("button", { name: "Create codes for all tables" }),
    );
    await waitFor(() =>
      expect(urls().every((u) => /&k=[A-Za-z0-9]{12}$/.test(u))).toBe(true),
    );
    const keys = loadDemoState().tableKeys;
    expect(Object.keys(keys)).toEqual(["1", "2"]);
    expect(urls()[0]).toContain(`/order?table=1&k=${keys[1]}`);
  });

  it("renews one table's code only after an in-page confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    await openQrPage();
    await user.click(
      await screen.findByRole("button", {
        name: "Create codes for all tables",
      }),
    );
    const before = await waitFor(() => {
      const k = loadDemoState().tableKeys;
      expect(k[1]).toBeTruthy();
      return k;
    });

    await user.click(screen.getAllByRole("button", { name: "New code" })[0]);
    const panel = screen.getByRole("group", { name: "New code for table 1" });
    expect(
      within(panel).getByText(/stops working straight away/),
    ).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(loadDemoState().tableKeys[1]).toBe(before[1]);

    await user.click(screen.getAllByRole("button", { name: "New code" })[0]);
    await user.click(screen.getByRole("button", { name: "Make new code" }));
    await screen.findByText(/New code made/);
    expect(loadDemoState().tableKeys[1]).not.toBe(before[1]);
    expect(loadDemoState().tableKeys[2]).toBe(before[2]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("gives a newly added table a code once the cafe uses codes", async () => {
    const user = userEvent.setup();
    await openQrPage();
    await user.click(
      await screen.findByRole("button", {
        name: "Create codes for all tables",
      }),
    );
    await screen.findByText(/Every table has a code/);
    await user.click(screen.getByRole("button", { name: "One table more" }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));
    await waitFor(() =>
      expect(Object.keys(loadDemoState().tableKeys)).toEqual(["1", "2", "3"]),
    );
  });

  it("does not switch codes on by itself when the owner adds a table", async () => {
    const user = userEvent.setup();
    await openQrPage();
    await screen.findByRole("button", { name: "Create codes for all tables" });
    await user.click(screen.getByRole("button", { name: "One table more" }));
    await user.click(screen.getByRole("button", { name: "Save tables" }));
    await screen.findByText(/Saved/);
    expect(loadDemoState().tableKeys).toEqual({});
  });
});

/**
 * Staff confirming new guests (src/lib/table-open.ts), on the demo store: the
 * board's "New guests" section, Accept and Reject, the "Open tables" strip,
 * the customer's waiting screen, and the owner's switch.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmationPage from "@/app/order/confirmation/page";
import StaffPage from "@/app/staff/page";
import { NewGuestsSetting } from "@/components/NewGuestsSetting";
import { DataProvider } from "@/components/providers/DataProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import {
  DemoRulesRefusal,
  demoAcceptOrder,
  demoAssignDayNumber,
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { TABLE_OPEN_MS } from "@/lib/table-open";

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

const HOUR = 3600_000;
const byIdOf = (id: string) => loadDemoState().orders.find((o) => o.id === id);
const newGuestOrder = (tableNumber = 2) =>
  demoOrderRepo.create({
    tableNumber,
    items: [{ menuItemId: "m1", name: "Latte", qty: 2, price: 200 }],
    total: 400,
  });

describe("staff board: new guests", () => {
  it("lists a pending order in its own section, table number first", async () => {
    await newGuestOrder(7);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const section = await screen.findByRole("region", {
      name: "New guests — check the table",
    });
    expect(within(section).getByText("7")).toHaveClass("text-5xl");
    expect(within(section).getByText("Latte")).toBeVisible();
    expect(within(section).getAllByText("₹400").length).toBeGreaterThan(0);
    expect(
      within(section).getByRole("button", { name: "Accept" }),
    ).toBeVisible();
    expect(within(section).getByText("Waiting for the counter")).toBeVisible();
    // and not also as kitchen work
    expect(screen.getByText("Nothing in the kitchen yet.")).toBeVisible();
  });

  it("Accept sends it to the kitchen and opens the table for three hours", async () => {
    const user = userEvent.setup();
    const order = await newGuestOrder(2);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const before = Date.now();
    await user.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(loadDemoState().orders[0].status).toBe("preparing"),
    );
    const openUntil = loadDemoState().tableSessions[2];
    expect(openUntil).toBeGreaterThanOrEqual(before + TABLE_OPEN_MS);
    expect(openUntil).toBeLessThanOrEqual(Date.now() + TABLE_OPEN_MS);
    // the ticket has moved to the kitchen list, and the section is gone
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "New guests — check the table" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Open tables" })).getByText(
        "T2",
      ),
    ).toBeVisible();
    expect(order.status).toBe("pending");
  });

  it("Reject suggests 'No one at this table' and turns the order away", async () => {
    const user = userEvent.setup();
    const order = await newGuestOrder(2);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(
      await screen.findByRole("button", {
        name: `Reject order #${order.orderNumber}`,
      }),
    );
    expect(
      screen.getByRole("button", { name: "No one at this table" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Reject order" }));

    await waitFor(() =>
      expect(loadDemoState().orders[0]).toMatchObject({
        status: "rejected",
        rejectReason: "No one at this table",
      }),
    );
    // rejecting a new guest does not open the table
    expect(loadDemoState().tableSessions[2]).toBeUndefined();
  });

  it("numbers a new guest's order only once it is accepted", async () => {
    const user = userEvent.setup();
    const turnedAway = await newGuestOrder(5);
    const guest = await newGuestOrder(2);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const section = await screen.findByRole("region", {
      name: "New guests — check the table",
    });
    // The board is running its numbering, but leaves waiting orders alone.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(loadDemoState().orders.every((o) => o.dayNumber === undefined)).toBe(
      true,
    );
    expect(within(section).getAllByText("Number on Accept")).toHaveLength(2);

    // Turned away: it never gets a number, so the day's list has no gap.
    // Table 5's ticket: two unnumbered tickets can share a 3-digit stand-in.
    const turnedAwayTicket = within(section)
      .getAllByText("5")[0]
      .closest<HTMLElement>("[role=listitem]")!;
    await user.click(
      within(turnedAwayTicket).getByRole("button", { name: /^Reject order/ }),
    );
    await user.click(screen.getByRole("button", { name: "Reject order" }));
    await waitFor(() =>
      expect(
        loadDemoState().orders.find((o) => o.id === turnedAway.id)?.status,
      ).toBe("rejected"),
    );

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("#0001")).toBeVisible();
    const state = loadDemoState();
    expect(state.orders.find((o) => o.id === guest.id)?.dayNumber).toBe(1);
    expect(
      state.orders.find((o) => o.id === turnedAway.id)?.dayNumber,
    ).toBeUndefined();
  });

  it("shows open tables with their time left, and Close closes one", async () => {
    const user = userEvent.setup();
    demoSetTableOpenUntil(4, Date.now() + 2 * HOUR + 30 * 60_000);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const strip = await screen.findByRole("region", { name: "Open tables" });
    expect(within(strip).getByText("T4")).toBeVisible();
    expect(within(strip).getByText(/^2h (29|30)m left$/)).toBeVisible();

    // Close asks first, and "Keep open" leaves the table alone.
    await user.click(
      within(strip).getByRole("button", { name: "Close table 4" }),
    );
    expect(within(strip).getByText("Close table 4?")).toBeVisible();
    await user.click(within(strip).getByRole("button", { name: "Keep open" }));
    expect(within(strip).queryByText("Close table 4?")).toBeNull();
    expect(loadDemoState().tableSessions[4]).toBeGreaterThan(Date.now());

    await user.click(
      within(strip).getByRole("button", { name: "Close table 4" }),
    );
    await user.click(
      within(strip).getByRole("button", { name: "Close table" }),
    );
    await waitFor(() =>
      expect(loadDemoState().tableSessions[4]).toBeLessThanOrEqual(Date.now()),
    );
    expect(await within(strip).findByText(/^None\./)).toBeVisible();
  });

  it("Accept takes every waiting order from that table, and all get numbers", async () => {
    const user = userEvent.setup();
    const first = await newGuestOrder(6);
    const second = await newGuestOrder(6); // a second phone at the same table
    const elsewhere = await newGuestOrder(8);
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    const section = await screen.findByRole("region", {
      name: "New guests — check the table",
    });
    // Table 6's tickets, not table 8's (all three can share a millisecond).
    const ticket = within(section)
      .getAllByText("6")[0]
      .closest<HTMLElement>("[role=listitem]")!;
    await user.click(within(ticket).getByRole("button", { name: "Accept" }));
    await waitFor(() => {
      const byId = new Map(loadDemoState().orders.map((o) => [o.id, o]));
      expect(byId.get(first.id)?.status).toBe("preparing");
      expect(byId.get(second.id)?.status).toBe("preparing");
      expect(byId.get(elsewhere.id)?.status).toBe("pending");
    });
    await waitFor(
      () => {
        const byId = new Map(loadDemoState().orders.map((o) => [o.id, o]));
        expect(
          [
            byId.get(first.id)?.dayNumber,
            byId.get(second.id)?.dayNumber,
          ].sort(),
        ).toEqual([1, 2]);
      },
      { timeout: 5000 },
    );
    expect(byIdOf(elsewhere.id)?.dayNumber).toBeUndefined();
  });

  it("on a tablet whose clock is over an hour fast, Mark ready still works", async () => {
    const user = userEvent.setup();
    const order = await newGuestOrder(3);
    demoAcceptOrder(order.id, Date.now() + HOUR);
    const before = loadDemoState().tableSessions[3];
    // The rules refuse the combined commit (openUntil past the 4-hour
    // limit by the server's clock); the plain status change is fine.
    const real = demoOrderRepo.setStatus.bind(demoOrderRepo);
    const setStatus = vi
      .spyOn(demoOrderRepo, "setStatus")
      .mockImplementation(async (id, status, keep) => {
        if (keep)
          throw new DemoRulesRefusal("a table can open for at most 4 hours");
        return real(id, status);
      });
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(await screen.findByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(loadDemoState().orders[0].status).toBe("ready"));
    expect(setStatus).toHaveBeenCalledTimes(2);
    expect(setStatus.mock.calls[1][2]).toBeUndefined();
    expect(loadDemoState().tableSessions[3]).toBe(before);
    expect(screen.queryByText(/permission|4 hours/i)).toBeNull();
    setStatus.mockRestore();
  });

  it("keeps an open table open while staff work on its orders", async () => {
    const user = userEvent.setup();
    const order = await newGuestOrder(3);
    demoAcceptOrder(order.id, Date.now() + HOUR); // an hour left
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(await screen.findByRole("button", { name: "Mark ready" }));
    await waitFor(() =>
      expect(loadDemoState().tableSessions[3]).toBeGreaterThan(
        Date.now() + 2 * HOUR,
      ),
    );
  });

  it("does not reopen a closed table when an old order moves on", async () => {
    const user = userEvent.setup();
    const order = await newGuestOrder(3);
    demoAcceptOrder(order.id, Date.now() + HOUR);
    demoSetTableOpenUntil(3, Date.now()); // the group left; staff closed it
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);

    await user.click(await screen.findByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(loadDemoState().orders[0].status).toBe("ready"));
    expect(loadDemoState().tableSessions[3]).toBeLessThanOrEqual(Date.now());
  });

  it("the badge reads 'Waiting for the counter' in history too", () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText("Waiting for the counter")).toBeVisible();
  });
});

describe("customer: waiting for the counter", () => {
  const open = (id: string) => {
    window.history.replaceState({}, "", `/order/confirmation?table=2&id=${id}`);
    render(<ConfirmationPage />);
  };

  it("says kindly that the counter will confirm the table, then moves on when accepted", async () => {
    const order = await newGuestOrder(2);
    open(order.id);

    expect(
      await screen.findByRole("heading", {
        name: "Waiting for the counter to confirm your table",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Nothing to do here/)).toBeVisible();
    expect(screen.getByText("Latte")).toBeVisible();
    // No number while it waits, and no stand-in that would change.
    expect(screen.queryByText(/#\d/)).toBeNull();

    act(() => demoAcceptOrder(order.id, Date.now() + HOUR));
    expect(await screen.findByText("Got it!")).toBeVisible();
    expect(screen.getByText("Being made right now.")).toBeVisible();
    // Accepted: now the number is coming (the board hands it out).
    expect(screen.getByText("Your number is coming…")).toBeVisible();
    await act(async () => {
      await demoAssignDayNumber(order.id);
    });
    expect(await screen.findAllByText(/#0001/)).not.toHaveLength(0);
  });

  it("shows the rejected notice when staff turn it away", async () => {
    const order = await newGuestOrder(2);
    open(order.id);
    await screen.findByText(/Waiting for the counter to confirm/);

    await act(() => demoOrderRepo.reject(order.id, "No one at this table"));
    expect(await screen.findByText(/couldn.t accept this order/)).toBeVisible();
    expect(screen.getByText("No one at this table")).toBeVisible();
  });
});

describe("owner: the 'Approve new tables' switch", () => {
  it("is off by default and the owner can switch it on and off", async () => {
    const user = userEvent.setup();
    await demoAuthRepo.signIn(
      DEMO_CREDENTIALS.owner.email,
      DEMO_CREDENTIALS.owner.password,
    );
    render(
      <DataProvider>
        <NewGuestsSetting />
      </DataProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Approve new tables" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Off: every order goes straight to the kitchen/),
    ).toBeVisible();
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleName(/Approve new tables/);

    await user.click(toggle);
    await waitFor(() =>
      expect(loadDemoState().ordering.confirmNewGuests).toBe(true),
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    await waitFor(() =>
      expect(loadDemoState().ordering.confirmNewGuests).toBe(false),
    );
  });

  it("a barista cannot change it", async () => {
    const user = userEvent.setup();
    await demoAuthRepo.signInWithPin("1122");
    render(
      <DataProvider>
        <NewGuestsSetting />
      </DataProvider>,
    );
    await user.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That didn't save",
    );
    expect(loadDemoState().ordering.confirmNewGuests).toBe(false);
  });
});

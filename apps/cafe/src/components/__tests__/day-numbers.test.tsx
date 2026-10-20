/**
 * Today's order numbers (#0001…) on the demo store: the staff board hands them
 * out, the customer's screen waits for one without inventing it, and only
 * staff can number an order.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmationPage from "@/app/order/confirmation/page";
import StaffPage from "@/app/staff/page";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import {
  demoAcceptOrder,
  demoAssignDayNumber,
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { istDayKey, NUMBER_WAIT_MS } from "@/lib/order-number";

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

const HOUR = 3_600_000;

// An order from a table staff have opened, so it goes straight to the kitchen
// (`preparing`). A new guest's order waits as `pending` and is not numbered
// until accepted; `placeWaiting` makes one of those.
const place = (tableNumber = 2) => {
  demoSetTableOpenUntil(tableNumber, Date.now() + HOUR);
  return demoOrderRepo.create({
    tableNumber,
    items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
    total: 200,
    status: "preparing",
  });
};
const placeWaiting = (tableNumber = 2) =>
  demoOrderRepo.create({
    tableNumber,
    items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
    total: 200,
    status: "pending",
  });

describe("demo store: numbering", () => {
  it("numbers from 1 in the order asked, under the order's IST day", async () => {
    const a = await place();
    const b = await place();
    expect(await demoAssignDayNumber(a.id)).toEqual({
      dayNumber: 1,
      dayKey: istDayKey(a.createdAt),
    });
    expect(await demoAssignDayNumber(b.id)).toMatchObject({ dayNumber: 2 });
    expect(await demoAssignDayNumber(a.id)).toBeNull();
    const state = loadDemoState();
    expect(state.orders.map((o) => o.dayNumber)).toEqual([1, 2]);
    expect(state.dayCounters[istDayKey(a.createdAt)]).toBe(3);
  });

  it("hands out unique numbers when asked all at once", async () => {
    const orders = [];
    for (let i = 0; i < 6; i += 1) orders.push(await place());
    await Promise.all(
      [...orders, ...orders].map((o) => demoAssignDayNumber(o.id)),
    );
    const numbers = loadDemoState().orders.map((o) => o.dayNumber);
    expect(new Set(numbers).size).toBe(6);
    expect([...numbers].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("does not number an order waiting for the counter until it is accepted", async () => {
    const guest = await placeWaiting(5);
    expect(guest.status).toBe("pending");
    expect(await demoAssignDayNumber(guest.id)).toBeNull();
    expect(loadDemoState().dayCounters).toEqual({});
    const other = await place(2);
    expect(await demoAssignDayNumber(other.id)).toMatchObject({ dayNumber: 1 });
    demoAcceptOrder(guest.id, Date.now() + HOUR);
    expect(await demoAssignDayNumber(guest.id)).toMatchObject({ dayNumber: 2 });
  });

  it("only staff and the owner may number an order", async () => {
    const a = await place();
    await expect(demoOrderRepo.assignDayNumber(a.id)).rejects.toMatchObject({
      code: "permission-denied",
    });
    await demoAuthRepo.signInWithPin("1122");
    await expect(demoOrderRepo.assignDayNumber(a.id)).resolves.toMatchObject({
      dayNumber: 1,
    });
  });
});

describe("staff board", () => {
  it("numbers orders #0001, #0002, #0003 in the order they came in", async () => {
    await demoAuthRepo.signInWithPin("1122");
    render(<StaffPage />);
    await screen.findByText("All caught up");

    await act(async () => {
      await place(3);
      await place(1);
      await place(2);
    });

    await waitFor(() =>
      expect(loadDemoState().orders.every((o) => o.dayNumber)).toBe(true),
    );
    const byTable = Object.fromEntries(
      loadDemoState().orders.map((o) => [o.tableNumber, o.dayNumber]),
    );
    expect(byTable).toEqual({ 3: 1, 1: 2, 2: 3 });
    for (const label of ["#0001", "#0002", "#0003"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });
});

describe("customer's screen", () => {
  it("says a number is coming, then shows it once the board assigns it", async () => {
    const order = await place();
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=2&id=${order.id}`,
    );
    render(<ConfirmationPage />);
    await screen.findByText("Got it!");
    expect(screen.getByText("Your number is coming…")).toBeInTheDocument();
    // No stand-in number while it waits.
    expect(screen.queryByText(/#\d/)).toBeNull();
    expect(screen.getAllByText(/Order received/).length).toBeGreaterThan(0);

    await act(async () => {
      await demoAssignDayNumber(order.id);
    });
    expect(await screen.findAllByText(/#0001/)).not.toHaveLength(0);
    expect(screen.queryByText("Your number is coming…")).toBeNull();
  });

  it("stops promising a number when no board gives one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const order = await place();
      window.history.replaceState(
        {},
        "",
        `/order/confirmation?table=2&id=${order.id}`,
      );
      render(<ConfirmationPage />);
      await screen.findByText("Your number is coming…");
      await act(async () => {
        vi.advanceTimersByTime(NUMBER_WAIT_MS + 1000);
      });
      expect(await screen.findByText("The counter has it.")).toBeVisible();
      expect(screen.queryByText("Your number is coming…")).toBeNull();
      expect(screen.queryByText(/#\d/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The owner's order history (/admin/orders), on the demo backend: one bounded
 * query per range, filters and search on what came back, rows that open to the
 * whole order, and totals that agree with the Reports page.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminLayout from "@/app/admin/layout";
import OrderHistoryPage from "@/app/admin/orders/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { demoAuthRepo, demoOrderRepo } from "@/lib/data/demo";
import { demoSeedOrders, resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { formatINR } from "@/lib/money";
import {
  HISTORY_LIMIT,
  TERMINAL_STATUSES,
  presetRange,
} from "@/lib/order-history";
import { buildReport } from "@/lib/reports";
import type { Order } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/orders",
}));

/** 28 Sept 2026, 3 pm local: a fixed "now" so the ranges are predictable. */
const NOW = new Date(2026, 8, 28, 15, 0).getTime();
const at = (daysAgo: number, hour: number) =>
  new Date(2026, 8, 28 - daysAgo, hour, 0).getTime();

function line(name: string, price: number, qty = 1) {
  return { menuItemId: `m-${name}`, name, price, qty };
}

type Seed = Omit<Order, "id" | "orderNumber">;
function seed(over: Partial<Seed>): Seed {
  const items = over.items ?? [line("Masala Chai", 60)];
  return {
    tableNumber: 1,
    items,
    total: items.reduce((s, l) => s + l.price * l.qty, 0),
    status: "completed",
    createdAt: at(0, 10),
    paymentMethod: "counter",
    ...over,
  };
}

const SEEDS: Seed[] = [
  seed({
    tableNumber: 2,
    createdAt: at(0, 9),
    items: [line("Cappuccino", 180, 2), line("Blueberry Scone", 120)],
    notes: "Less sugar",
  }),
  seed({ tableNumber: 4, createdAt: at(0, 11), status: "preparing" }),
  // total does not match its items (issue #27)
  seed({
    tableNumber: 4,
    createdAt: at(0, 12),
    items: [line("Cold Brew", 200)],
    total: 20,
  }),
  seed({ tableNumber: 3, createdAt: at(1, 13) }),
  seed({ tableNumber: 5, createdAt: at(5, 14) }),
  seed({ tableNumber: 6, createdAt: at(20, 14) }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemoStore();
  demoSeedOrders(SEEDS);
});

function renderPage() {
  return render(
    <DataProvider>
      <OrderHistoryPage />
    </DataProvider>,
  );
}

async function allStored(): Promise<Order[]> {
  return demoOrderRepo.listRange(0, NOW + 86_400_000);
}

const rows = () =>
  screen
    .queryAllByRole("button", { expanded: false })
    .concat(screen.queryAllByRole("button", { expanded: true }))
    .filter((b) => b.closest("li[data-order-id]"));

describe("order history: ranges", () => {
  it("loads today by default, with one capped range query", async () => {
    const spy = vi.spyOn(demoOrderRepo, "listRange");
    renderPage();
    const today = presetRange("today", NOW);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(today.from, today.to, HISTORY_LIMIT),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await screen.findByText(/3 orders ·/);
  });

  it.each([
    ["Yesterday", "yesterday", /1 order ·/],
    ["Last 7 days", "last7", /5 orders ·/],
    ["This month", "month", /6 orders ·/],
  ] as const)("%s queries its own range", async (label, id, summary) => {
    const user = userEvent.setup();
    const spy = vi.spyOn(demoOrderRepo, "listRange");
    renderPage();
    await screen.findByText(/3 orders ·/);

    await user.click(screen.getByRole("button", { name: label }));
    const r = presetRange(id, NOW);
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(r.from, r.to, HISTORY_LIMIT),
    );
    expect(screen.getByRole("button", { name: label })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText(summary)).toBeInTheDocument();
  });

  it("takes a custom range, and refuses one longer than 31 days", async () => {
    const spy = vi.spyOn(demoOrderRepo, "listRange");
    renderPage();
    await screen.findByText(/3 orders ·/);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-09-26" },
    });
    // the 26th to today: yesterday's order and today's three
    await screen.findByText(/4 orders ·/);
    expect(
      screen
        .getByRole("button", { name: "Today" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    const calls = spy.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-07-01" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /at most 31 days/,
    );
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("offers the sample month in demo mode when a range is empty", async () => {
    resetDemoStore();
    demoSeedOrders([]);
    renderPage();
    expect(
      await screen.findByText("No orders in this range"),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Add a sample month/ }));
    await waitFor(() =>
      expect(
        screen.queryByText("No orders in this range"),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a friendly message when the database refuses the read", async () => {
    vi.spyOn(demoOrderRepo, "listRange").mockRejectedValue(
      Object.assign(new Error("Missing or insufficient permissions."), {
        code: "permission-denied",
      }),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /isn't allowed to read past orders/,
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("order history: summary", () => {
  it("adds up exactly what the Reports page does", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3 orders ·/);
    await user.click(screen.getByRole("button", { name: "This month" }));

    const month = presetRange("month", NOW);
    const report = buildReport(await allStored(), month);
    expect(
      await screen.findByText(
        `${report.orderCount} orders · ${formatINR(report.revenue)}`,
      ),
    ).toBeInTheDocument();
    // from the items, so the ₹20 order counts as ₹200
    expect(report.revenue).toBe(480 + 60 + 200 + 60 + 60 + 60);
  });
});

describe("order history: rejected orders", () => {
  it("lists them, filters to them, and leaves them out of takings", async () => {
    const user = userEvent.setup();
    const open = (await allStored()).find((o) => o.status === "preparing")!;
    await demoOrderRepo.reject(open.id, "Duplicate order");
    renderPage();

    // 3 today, one rejected: 2 counted, ₹480 + ₹200 (from the items)
    expect(await screen.findByText("2 orders · ₹680")).toBeInTheDocument();
    expect(
      screen.getByText(/Plus 1 rejected order, not counted/),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(3);

    await user.selectOptions(screen.getByLabelText("Status"), "rejected");
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(within(row).getByText("Rejected")).toBeInTheDocument();
    await user.click(row);
    expect(screen.getByText(/Reason given:/)).toBeInTheDocument();
    expect(screen.getByText("Duplicate order")).toBeInTheDocument();
  });
});

describe("order history: filters and search", () => {
  it("lists newest first and filters by status and table", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3 orders ·/);

    const tables = () =>
      rows().map(
        (r) => within(r).getByText(/^Table \d+$/).textContent as string,
      );
    expect(tables()).toEqual(["Table 4", "Table 4", "Table 2"]);

    await user.selectOptions(screen.getByLabelText("Status"), "active");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText(/Showing 1 order of 3/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.selectOptions(screen.getByLabelText("Table"), "2");
    expect(tables()).toEqual(["Table 2"]);
  });

  it("offers every terminal status from the status union", async () => {
    renderPage();
    await screen.findByText(/3 orders ·/);
    const select = screen.getByLabelText("Status");
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["all", "active", ...TERMINAL_STATUSES]);
    expect(TERMINAL_STATUSES).toContain("completed");
  });

  it("searches by order number and by item name", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3 orders ·/);

    const target = (await allStored()).find((o) => o.tableNumber === 2)!;
    // Seeded orders are numbered per IST day, as the board would have.
    expect(target.dayNumber).toBeGreaterThan(0);
    const label = `#${String(target.dayNumber).padStart(4, "0")}`;
    const bare = String(target.dayNumber);
    for (const query of [label, label.slice(1), bare]) {
      await user.clear(screen.getByLabelText("Search"));
      await user.type(screen.getByLabelText("Search"), query);
      expect(
        rows().some(
          (r) =>
            r.textContent?.includes(label) &&
            r.textContent?.includes("Table 2"),
        ),
      ).toBe(true);
      expect(rows().every((r) => r.textContent?.includes(bare))).toBe(true);
    }

    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "cold brew");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Table 4");

    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "croissant");
    expect(
      screen.getByText("No orders match these filters."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(3);
  });
});

describe("order history: rows", () => {
  it("opens a row to its items, note, times and order ID", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3 orders ·/);

    const row = rows().find((r) => r.textContent?.includes("Table 2"))!;
    expect(row).toHaveTextContent("3 items");
    expect(screen.queryByText("Less sugar")).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      row.getAttribute("aria-controls") as string,
    )!;
    expect(within(panel).getByText("2 × ₹180")).toBeInTheDocument();
    expect(within(panel).getByText("₹360")).toBeInTheDocument();
    expect(within(panel).getByText("Less sugar")).toBeInTheDocument();
    expect(within(panel).getByText("At the counter")).toBeInTheDocument();
    expect(within(panel).getByText("Placed")).toBeInTheDocument();
    expect(within(panel).getByText("Completed")).toBeInTheDocument();
    const id = row.closest("li")!.getAttribute("data-order-id")!;
    expect(within(panel).getByText(id)).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: `Copy order ID ${id}` }),
    ).toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Less sugar")).not.toBeInTheDocument();
  });

  it("flags an order whose total does not match its items", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/3 orders ·/);

    const flagged = rows().filter((r) =>
      r.textContent?.includes("Total doesn't match items"),
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent("₹20");

    await user.click(flagged[0]);
    expect(
      screen.getByText(/Order says ₹20, but its items add up to ₹200/),
    ).toBeInTheDocument();
  });

  it("finds an older order by its older short number", async () => {
    const user = userEvent.setup();
    const legacy = {
      ...seed({ createdAt: at(0, 8), tableNumber: 9 }),
      id: "o-legacy",
      orderNumber: 417,
    } as Order;
    const numbered = {
      ...seed({ createdAt: at(0, 9), tableNumber: 8 }),
      id: "o-new",
      orderNumber: 999,
      dayNumber: 41,
      dayKey: "2026-09-28",
    } as Order;
    vi.spyOn(demoOrderRepo, "listRange").mockResolvedValue([legacy, numbered]);
    renderPage();
    await screen.findByText("#417");
    expect(screen.getByText("#0041")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search"), "417");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("#417");

    // A day-numbered order is not found by the fallback number it never shows.
    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "999");
    expect(
      screen.getByText("No orders match these filters."),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "#0041");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Table 8");
  });

  it("renders a status it does not know, and a reject reason when present", async () => {
    const user = userEvent.setup();
    const odd = {
      ...seed({ createdAt: at(0, 8), tableNumber: 9 }),
      id: "o-odd",
      orderNumber: 555,
      status: "refunded",
      rejectReason: "Duplicate order",
    } as unknown as Order;
    vi.spyOn(demoOrderRepo, "listRange").mockResolvedValue([odd]);
    renderPage();

    const row = (await screen.findByText("#555")).closest("button")!;
    expect(within(row).getByText("Refunded")).toBeInTheDocument();
    await user.click(row);
    expect(screen.getByText("Duplicate order")).toBeInTheDocument();
    expect(screen.getByText(/Reason given:/)).toBeInTheDocument();
  });

  it("pages long lists 50 at a time", async () => {
    const user = userEvent.setup();
    resetDemoStore();
    demoSeedOrders(
      Array.from({ length: 60 }, (_, i) =>
        seed({ createdAt: at(0, 0) + i * 60_000 }),
      ),
    );
    renderPage();
    await screen.findByText(/60 orders ·/);
    expect(rows()).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(rows()).toHaveLength(60);
  });
});

describe("StatusBadge", () => {
  it("renders an unknown status as a neutral badge with its own name", () => {
    render(<StatusBadge status="partly_refunded" />);
    const badge = screen.getByText("Partly refunded").closest("[data-status]");
    expect(badge).toHaveAttribute("data-status", "partly_refunded");
  });
});

describe("owner navigation", () => {
  it("has a History section, current on /admin/orders", async () => {
    vi.useRealTimers();
    const { email, password } = DEMO_CREDENTIALS.owner;
    await demoAuthRepo.signIn(email, password);
    render(
      <AdminLayout>
        <p>child</p>
      </AdminLayout>,
    );
    const nav = await screen.findByRole("navigation", {
      name: "Dashboard sections",
    });
    const link = within(nav).getByRole("link", { name: "History" });
    expect(link).toHaveAttribute("href", "/admin/orders");
    expect(link).toHaveAttribute("aria-current", "page");
    // the live board keeps the name "Orders"; the section is not a second one
    expect(within(nav).queryByRole("link", { name: "Orders" })).toBeNull();
    await demoAuthRepo.signOut();
  });
});

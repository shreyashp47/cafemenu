/**
 * Component tests for the pieces a user actually touches: the cart sheet maths,
 * the staff status buttons, and the order-status presentation.
 *
 * These render the real components against the demo store, so they also act as
 * an integration test of the data layer.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Icon } from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import { NotSetUp } from "@/components/NotSetUp";
import { UpdateBar } from "@/components/Pwa";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Input, Select } from "@/components/ui/Input";
import { demoMenuRepo, demoOrderRepo } from "@/lib/data/demo";
import { resetDemoStore, loadDemoState } from "@/lib/data/demo-store";
import { cartReducer, emptyCart, readStoredCart } from "@/lib/cart";
import { cartTotal } from "@/lib/money";
import { actionsFor, transition, type OrderStatus } from "@/lib/order-status";
import type { CartLine, MenuItem, Order } from "@/lib/types";

beforeEach(() => {
  resetDemoStore();
  vi.useRealTimers();
});

describe("Mascot", () => {
  it("is labelled for screen readers", () => {
    render(<Mascot />);
    expect(screen.getByRole("img", { name: /mascot/i })).toBeInTheDocument();
  });

  it("renders every mood", () => {
    for (const mood of ["happy", "cheer", "sleepy", "worry"] as const) {
      const { unmount } = render(<Mascot mood={mood} />);
      expect(screen.getByRole("img")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("Icon", () => {
  it("is hidden from assistive tech unless given a title", () => {
    const { container, rerender } = render(<Icon name="cart" />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    rerender(<Icon name="cart" title="Your order" />);
    expect(screen.getByRole("img", { name: "Your order" })).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it.each([
    ["received", "Received"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
    ["served", "Served"],
    ["completed", "Completed"],
  ] as Array<[OrderStatus, string]>)("labels %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("exposes the status to tests and CSS alike", () => {
    const { container } = render(<StatusBadge status="ready" />);
    expect(
      container.querySelector("[data-status='ready']"),
    ).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Hi</Button>);
    expect(screen.getByRole("button", { name: "Hi" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Sheet", () => {
  it("is a modal dialog with an accessible name", () => {
    render(
      <Sheet open onClose={() => {}} title="Table 4">
        <p>contents</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Table 4" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes on the close button", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Table 4">
        <p>contents</p>
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close cart" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Table 4">
        <p>contents</p>
      </Sheet>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Table 4">
        <p>contents</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("cart maths in the UI", () => {
  /** Mirrors the real CartSheet footer: steppers drive the total. */
  function CartHarness({ menu }: { menu: MenuItem[] }) {
    const [lines, setLines] = useState<CartLine[]>([]);
    const dispatch = (action: Parameters<typeof cartReducer>[1]) =>
      setLines((prev) => cartReducer(prev, action));
    return (
      <div>
        <ul>
          {lines.map((line) => (
            <li key={line.menuItemId}>
              <span>
                {line.name} ×{line.qty}
              </span>
              <span data-testid={`total-${line.menuItemId}`}>
                {line.price * line.qty}
              </span>
            </li>
          ))}
        </ul>
        <p data-testid="cart-total">{cartTotal(lines)}</p>
        {menu.map((item) => (
          <Button
            key={item.id}
            onClick={() => dispatch({ type: "add", item })}
            disabled={!item.available}
          >
            {`Add ${item.name}`}
          </Button>
        ))}
        {lines[0] ? (
          <>
            <Button
              onClick={() =>
                dispatch({ type: "increment", menuItemId: lines[0].menuItemId })
              }
            >
              More
            </Button>
            <Button
              onClick={() =>
                dispatch({ type: "decrement", menuItemId: lines[0].menuItemId })
              }
            >
              Less
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  const menu: MenuItem[] = [
    {
      id: "m1",
      name: "Cappuccino",
      description: "",
      price: 180,
      category: "Drinks",
      available: true,
      sortOrder: 10,
    },
    {
      id: "m2",
      name: "Scone",
      description: "",
      price: 160,
      category: "Bites",
      available: false,
      sortOrder: 20,
    },
  ];

  it("adds, steps up and down, and shows the running total", async () => {
    const user = userEvent.setup();
    render(<CartHarness menu={menu} />);

    await user.click(screen.getByRole("button", { name: "Add Cappuccino" }));
    expect(screen.getByTestId("cart-total")).toHaveTextContent("180");

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("cart-total")).toHaveTextContent("360");

    await user.click(screen.getByRole("button", { name: "Less" }));
    expect(screen.getByTestId("cart-total")).toHaveTextContent("180");
  });

  it("never lets a sold-out item into the cart", async () => {
    const user = userEvent.setup();
    render(<CartHarness menu={menu} />);
    const soldOut = screen.getByRole("button", { name: "Add Scone" });
    expect(soldOut).toBeDisabled();
    await user.click(soldOut).catch(() => {});
    expect(screen.getByTestId("cart-total")).toHaveTextContent("0");
  });

  it("empties the cart when the last unit is removed", async () => {
    const user = userEvent.setup();
    render(<CartHarness menu={menu} />);
    await user.click(screen.getByRole("button", { name: "Add Cappuccino" }));
    await user.click(screen.getByRole("button", { name: "Less" }));
    expect(screen.getByTestId("cart-total")).toHaveTextContent("0");
  });
});

describe("staff status actions", () => {
  /** Mirrors the staff board footer: buttons come straight from the machine. */
  function BoardHarness({ order }: { order: Order }) {
    const [current, setCurrent] = useState<OrderStatus>(order.status);
    return (
      <div>
        <StatusBadge status={current} />
        {actionsFor(current)
          .slice()
          .sort((a, b) => Number(b.primary) - Number(a.primary))
          .map((action) => (
            <Button
              key={action.to}
              onClick={() => {
                const next = transition(current, action.to);
                if (next) setCurrent(next);
              }}
            >
              {action.label}
            </Button>
          ))}
      </div>
    );
  }

  const order: Order = {
    id: "o1",
    orderNumber: 101,
    tableNumber: 3,
    items: [{ menuItemId: "m1", name: "Cappuccino", qty: 2, price: 180 }],
    total: 360,
    status: "preparing",
    createdAt: Date.now(),
    paymentMethod: "counter",
  };

  it("advances preparing -> ready -> served -> completed", async () => {
    const user = userEvent.setup();
    render(<BoardHarness order={order} />);

    expect(screen.getByText("Preparing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark ready" }));
    expect(screen.getByText("Ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark served" }));
    expect(screen.getByText("Served")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("offers no actions once closed", () => {
    render(<BoardHarness order={{ ...order, status: "completed" }} />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("menu editing through the repository", () => {
  it("reflects an availability toggle immediately on the live list", async () => {
    const seen: MenuItem[][] = [];
    const stop = demoMenuRepo.subscribe((items) => seen.push(items));

    const target = seen[0][0];
    await demoMenuRepo.update(target.id, { available: false });

    await waitFor(() => {
      expect(seen.at(-1)?.find((i) => i.id === target.id)?.available).toBe(
        false,
      );
    });
    stop();
  });

  it("keeps the sold-out item out of the cart after reconcile", async () => {
    const items = await demoMenuRepo.list();
    const target = items[0];
    let cart = cartReducer(emptyCart(), { type: "add", item: target });
    expect(cart).toHaveLength(1);

    await demoMenuRepo.update(target.id, { available: false });
    cart = cartReducer(cart, {
      type: "reconcile",
      menu: await demoMenuRepo.list(),
    });
    expect(cart).toHaveLength(0);
  });
});

describe("order placement end to end (demo backend)", () => {
  it("writes a priced order that the active board picks up", async () => {
    const menu = await demoMenuRepo.list();
    const line = menu[0];

    const order = await demoOrderRepo.create({
      tableNumber: 5,
      items: [
        { menuItemId: line.id, name: line.name, qty: 2, price: line.price },
      ],
      total: line.price * 2,
    });

    // Table 5 has not been confirmed, so it waits for the counter — and the
    // board still sees it, in its new-guests section.
    expect(order.status).toBe("pending");
    expect(order.total).toBe(line.price * 2);

    const received: Order[][] = [];
    const stop = demoOrderRepo.subscribeActive((orders) =>
      received.push(orders),
    );
    expect(received.at(-1)?.map((o) => o.id)).toContain(order.id);
    stop();
  });

  it("stores a per-table cart key that matches what the UI reads", () => {
    const lines: CartLine[] = [
      {
        menuItemId: "m1",
        name: "Cappuccino",
        price: 180,
        qty: 1,
        category: "Drinks",
      },
    ];
    localStorage.setItem("cafe-qr-order.cart.v1.t7", JSON.stringify(lines));
    expect(readStoredCart(7)).toEqual(lines);
    expect(readStoredCart(8)).toEqual([]);
  });
});

describe("accessible table markup", () => {
  it("uses a real table with a caption-free header for the report", () => {
    render(
      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Cappuccino</th>
          </tr>
        </tbody>
      </table>,
    );
    expect(
      screen.getByRole("columnheader", { name: "Item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: "Cappuccino" }),
    ).toBeInTheDocument();
  });

  it("groups a form control under its label", () => {
    render(
      <>
        <label htmlFor="price">Price</label>
        <Input id="price" />
        <label htmlFor="cat">Category</label>
        <Select id="cat">
          <option>Drinks</option>
        </Select>
      </>,
    );
    expect(screen.getByLabelText("Price")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });
});

describe("demo store isolation between tests", () => {
  it("starts clean", () => {
    expect(loadDemoState().orders).toEqual([]);
  });

  it("does not leak a previous test's order", async () => {
    const order = await demoOrderRepo.create({
      tableNumber: 1,
      items: [{ menuItemId: "m1", name: "A", qty: 1, price: 1 }],
      total: 1,
    });
    expect(order.id).toBeTruthy();
    resetDemoStore();
    expect(loadDemoState().orders).toEqual([]);
  });
});

describe("account not set up (issue #33)", () => {
  it("explains itself and shows the owner what to set up", async () => {
    const onSignOut = vi.fn();
    render(
      <NotSetUp
        user={{ uid: "abc123UID", email: "asha@cafe.com" }}
        onSignOut={onSignOut}
      />,
    );
    expect(
      screen.getByText(/Your account isn.t set up yet — ask the owner/),
    ).toBeInTheDocument();
    expect(screen.getByText("abc123UID")).toBeInTheDocument();
    expect(screen.getByText("asha@cafe.com")).toBeInTheDocument();
    expect(
      screen.getByText(
        "npm run seed:staff -- --email=asha@cafe.com --role=staff",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe("service worker update bar", () => {
  it("offers a reload and lets the person decline it", async () => {
    const onDismiss = vi.fn();
    render(<UpdateBar onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "A new version is ready.",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

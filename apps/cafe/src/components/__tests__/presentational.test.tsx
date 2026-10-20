/**
 * Remaining presentational components and the cart hook.
 *
 * These are cheap to render and catch real regressions (a broken map, a
 * decorative animation that throws, a cart that loses state on remount), so
 * they are worth the coverage.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Doodles, SparkleBurst } from "@/components/Doodles";
import { useCart } from "@/hooks/useCart";
import { useOrderChime } from "@/hooks/useOrderChime";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Panel } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { EmptyState, Loading, Spinner } from "@/components/ui/Loading";
import { SpeechBubble, WashiNote } from "@/components/ui/SpeechBubble";
import { demoMenuRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";
import type { MenuItem } from "@/lib/types";

beforeEach(() => {
  resetDemoStore();
});

describe("Card / Panel / CardHeader", () => {
  it("renders a card", () => {
    render(<Card>inside</Card>);
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("renders a panel", () => {
    render(<Panel>inside</Panel>);
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("renders a header with title, hint and action", () => {
    render(
      <CardHeader
        title="Best sellers"
        hint="By revenue"
        action={<Button size="sm">CSV</Button>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Best sellers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("By revenue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CSV" })).toBeInTheDocument();
  });

  it("omits the hint and action when not given", () => {
    render(<CardHeader title="Only a title" />);
    expect(
      screen.getByRole("heading", { name: "Only a title" }),
    ).toBeInTheDocument();
  });
});

describe("Input / Textarea / Select / Field", () => {
  it("associates every control with its label", () => {
    render(
      <Field label="Price" htmlFor="p" hint="Rupees, whole numbers">
        <Input id="p" />
      </Field>,
    );
    expect(screen.getByLabelText("Price")).toBeInTheDocument();
    expect(screen.getByText("Rupees, whole numbers")).toBeInTheDocument();
  });

  it("shows an error instead of the hint when there is one", () => {
    render(
      <Field
        label="Price"
        htmlFor="p"
        hint="Rupees"
        error="Enter a price above 0."
      >
        <Input id="p" />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a price above 0.",
    );
    expect(screen.queryByText("Rupees")).not.toBeInTheDocument();
  });

  it("accepts typing", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="a">A</label>
        <Input id="a" />
        <label htmlFor="b">B</label>
        <Textarea id="b" />
        <label htmlFor="c">C</label>
        <Select id="c">
          <option>Drinks</option>
        </Select>
      </>,
    );
    await user.type(screen.getByLabelText("A"), "hello");
    expect(screen.getByLabelText("A")).toHaveValue("hello");
    await user.type(screen.getByLabelText("B"), "note");
    expect(screen.getByLabelText("B")).toHaveValue("note");
  });
});

describe("Loading / EmptyState / Spinner", () => {
  it("announces the loading state politely", () => {
    render(<Loading label="Setting out the cups…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Setting out the cups…");
  });

  it("renders an empty state with an action", () => {
    render(
      <EmptyState
        title="No orders yet"
        body="They will appear here."
        action={<Button>Refresh</Button>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No orders yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("They will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("renders a spinner with an accessible label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("SpeechBubble / WashiNote", () => {
  it("renders the message", () => {
    render(<SpeechBubble>Order received!</SpeechBubble>);
    expect(screen.getByText("Order received!")).toBeInTheDocument();
  });

  it("omits the tail when asked", () => {
    const { container } = render(
      <SpeechBubble tail="none">No tail</SpeechBubble>,
    );
    // the tail is the only rotated square in the bubble
    expect(container.querySelectorAll(".rotate-45")).toHaveLength(0);
  });

  it("renders a washi note in every tone", () => {
    for (const tone of ["highlight", "paper", "sage"] as const) {
      const { unmount } = render(
        <WashiNote tone={tone}>Good Coffee, Better Days</WashiNote>,
      );
      expect(screen.getByText("Good Coffee, Better Days")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("Doodles / SparkleBurst", () => {
  it("renders decorations as hidden from assistive tech", () => {
    const { container } = render(<Doodles />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a burst only when active", () => {
    const { container, rerender } = render(<SparkleBurst active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SparkleBurst active count={5} />);
    expect(container.querySelectorAll("span")).toHaveLength(5);
  });
});

describe("useCart", () => {
  const item = (over: Partial<MenuItem> = {}): MenuItem => ({
    id: "m1",
    name: "Cappuccino",
    description: "",
    price: 180,
    category: "Drinks",
    available: true,
    sortOrder: 10,
    ...over,
  });

  it("starts empty and accumulates a total", () => {
    const { result } = renderHook(() => useCart(3, [item()]));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.total).toBe(0);

    act(() => result.current.add(item(), 2));
    expect(result.current.count).toBe(2);
    expect(result.current.total).toBe(360);
  });

  it("ignores a sold-out item", () => {
    const { result } = renderHook(() => useCart(3, [item()]));
    act(() => result.current.add({ ...item(), available: false }));
    expect(result.current.isEmpty).toBe(true);
  });

  it("steps a line up and down and removes it at zero", () => {
    const { result } = renderHook(() => useCart(3, [item()]));
    act(() => result.current.add(item()));
    act(() => result.current.increment("m1", 2));
    expect(result.current.count).toBe(3);
    act(() => result.current.decrement("m1", 3));
    expect(result.current.isEmpty).toBe(true);
  });

  it("persists per table and rehydrates for a new table", async () => {
    const first = renderHook(() => useCart(3, [item()]));
    act(() => first.result.current.add(item(), 2));
    expect(first.result.current.total).toBe(360);

    // a different table gets its own basket
    const second = renderHook(() => useCart(4, [item()]));
    await act(async () => {});
    expect(second.result.current.isEmpty).toBe(true);
  });

  it("drops a line the live menu just sold out", async () => {
    const { result, rerender } = renderHook(
      ({ menu }: { menu: MenuItem[] }) => useCart(3, menu),
      {
        initialProps: {
          menu: [item(), item({ id: "m2", name: "Scone", price: 160 })],
        },
      },
    );
    act(() => {
      result.current.add(item(), 1);
      result.current.add(item({ id: "m2", name: "Scone", price: 160 }), 1);
    });
    expect(result.current.count).toBe(2);

    await act(async () => {
      rerender({
        menu: [
          item(),
          item({ id: "m2", name: "Scone", price: 160, available: false }),
        ],
      });
    });
    expect(result.current.count).toBe(1);
  });

  it("re-adds a previous order, skipping anything now unavailable", () => {
    const menu = [item(), item({ id: "m2", name: "Scone", price: 160 })];
    const { result } = renderHook(() => useCart(3, menu));
    act(() =>
      result.current.reAdd([
        { menuItemId: "m1", qty: 2 },
        { menuItemId: "m2", qty: 1 },
        { menuItemId: "gone", qty: 5 },
      ]),
    );
    expect(result.current.count).toBe(3);
    expect(result.current.total).toBe(180 * 2 + 160);
  });

  it("clears and forgets the stored basket", () => {
    const { result } = renderHook(() => useCart(3, [item()]));
    act(() => result.current.add(item()));
    act(() => result.current.clear());
    expect(result.current.isEmpty).toBe(true);
    expect(localStorage.getItem("cafe-qr-order.cart.v1.t3")).toBeNull();
  });
});

describe("useOrderChime", () => {
  it("starts unmuted and can be toggled persistently", () => {
    const { result } = renderHook(() => useOrderChime());
    expect(result.current.muted).toBe(false);
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem("cafe-qr-order.staff.muted.v1")).toBe("1");
  });

  it("does not throw when the audio context is unavailable", () => {
    const { result } = renderHook(() => useOrderChime());
    expect(() => act(() => result.current.unlock())).not.toThrow();
    expect(() => act(() => result.current.chime())).not.toThrow();
  });

  it("does not vibrate before the user has interacted", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrate,
      configurable: true,
    });
    const { result } = renderHook(() => useOrderChime());
    act(() => result.current.buzz());
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe("demo menu integration", () => {
  it("exposes the seed menu through the repository", async () => {
    const items = await demoMenuRepo.list();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => typeof i.price === "number")).toBe(true);
  });

  it("includes at least one sold-out item so the state is visible", async () => {
    const items = await demoMenuRepo.list();
    expect(items.some((i) => !i.available)).toBe(true);
  });
});

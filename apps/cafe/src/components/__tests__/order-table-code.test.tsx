/**
 * The table code on the customer's phone: out of the address bar at once,
 * good for 3 hours from the scan, never carried in the app's own links. Runs
 * the real pages on the demo store, which mirrors the rules on codes.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmationPage from "@/app/order/confirmation/page";
import OrderPage from "@/app/order/page";
import { getCafeName } from "@/lib/config";
import { demoAuthRepo, demoConfigRepo, demoOrderRepo } from "@/lib/data/demo";
import {
  demoSetTableOpenUntil,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { forgetLastOrder } from "@/lib/order-throttle";
import {
  TABLE_CODE_TTL_MS,
  forgetTableKeys,
  readTableKey,
  rememberTableKey,
} from "@/lib/table-keys";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const CODE = "ScannedCode1";
const HOUR = 3_600_000;
const SCAN_AGAIN =
  "It's been a while since you scanned. To order, please scan the QR code on your table again.";
const HINT = "To order, scan the QR code on your table.";

function openAt(search: string) {
  window.history.replaceState({}, "", `/order${search}`);
  render(<OrderPage />);
}

const menuShown = () => screen.findByRole("heading", { name: getCafeName() });

beforeEach(async () => {
  resetDemoStore();
  forgetTableKeys();
  forgetLastOrder();
  localStorage.clear();
  replace.mockClear();
  await demoAuthRepo.signOut();
  window.history.replaceState({}, "", "/order");
});

describe("/order takes the code out of the address", () => {
  it("saves it, then drops k and keeps the table and anything else", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    openAt(`?table=3&k=${CODE}&src=card`);
    await menuShown();
    await waitFor(() =>
      expect(window.location.search).toBe("?table=3&src=card"),
    );
    // null state, so Next's patched replaceState updates the router too (see
    // dropKeyFromAddress); its own state would make the router keep k.
    expect(spy).toHaveBeenCalledWith(null, "", "/order?table=3&src=card");
    expect(window.location.pathname).toBe("/order");
    expect(readTableKey(3)).toBe(CODE);
  });

  it("drops a malformed k too, without saving it", async () => {
    openAt("?table=3&k=bad");
    await menuShown();
    await waitFor(() => expect(window.location.search).toBe("?table=3"));
    expect(readTableKey(3)).toBeNull();
  });

  it("leaves an address with no k alone", async () => {
    window.history.replaceState({}, "", "/order?table=3");
    const spy = vi.spyOn(window.history, "replaceState");
    render(<OrderPage />);
    await menuShown();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows no scan notice on a fresh scan, not even for a moment", async () => {
    openAt(`?table=3&k=${CODE}`);
    await menuShown();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByText(SCAN_AGAIN)).toBeNull();
  });

  it("orders with the saved code after a reload of the cleaned address", async () => {
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: CODE });
    rememberTableKey(3, CODE, Date.now() - 2 * HOUR);
    openAt("?table=3"); // what a reload shows once k is gone
    await placeFirstItem(user);
    await waitFor(() => expect(loadDemoState().orders).toHaveLength(1));
  });
});

describe("/order before checkout", () => {
  it("hints to scan when this phone has never scanned here, but lets them try", async () => {
    const user = userEvent.setup();
    openAt("?table=3");
    await menuShown();
    expect(screen.getByText(HINT)).toBeVisible();
    // A table without a code yet still takes orders, so nothing is disabled:
    // the order is tried and the rules decide.
    await placeFirstItem(user);
    await waitFor(() => expect(loadDemoState().orders).toHaveLength(1));
  });

  it("still tells a keyless customer to scan when the table has a code", async () => {
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: CODE });
    openAt("?table=3");
    await placeFirstItem(user);
    expect(
      await screen.findByText(
        "To order, please scan the QR code on your table.",
      ),
    ).toBeVisible();
    expect(loadDemoState().orders).toHaveLength(0);
  });

  it("asks for a new scan before the basket, and blocks checkout, once the code has run out", async () => {
    const user = userEvent.setup();
    rememberTableKey(3, CODE, Date.now() - TABLE_CODE_TTL_MS - 60_000);
    openAt("?table=3");
    await menuShown();
    expect(screen.getByText(SCAN_AGAIN)).toBeVisible();
    expect(screen.queryByText(HINT)).toBeNull();

    await addAndOpenSheet(user);
    await user.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole("button", { name: /Place order/ })).toBeDisabled();
    expect(loadDemoState().orders).toHaveLength(0);
  });

  it("works again after a rescan", async () => {
    rememberTableKey(3, CODE, Date.now() - 4 * HOUR);
    openAt(`?table=3&k=${CODE}`);
    await menuShown();
    await waitFor(() => expect(window.location.search).toBe("?table=3"));
    expect(screen.queryByText(SCAN_AGAIN)).toBeNull();
    expect(readTableKey(3)).toBe(CODE);
  });
});

describe("/order left open past the 3 hours", () => {
  it("refuses at checkout without sending anything", async () => {
    const T0 = Date.now();
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: CODE });
    openAt(`?table=3&k=${CODE}`);
    await addAndOpenSheet(user);
    await user.click(await screen.findByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /Place order/ }),
    ).not.toBeDisabled();

    // The page has been sitting open; its expiry timer has not run yet.
    vi.setSystemTime(T0 + TABLE_CODE_TTL_MS + 60_000);
    await user.click(screen.getByRole("button", { name: /Place order/ }));

    expect(await screen.findAllByText(SCAN_AGAIN)).not.toHaveLength(0);
    expect(loadDemoState().orders).toHaveLength(0);
    expect(readTableKey(3)).toBeNull();
  });
});

describe("/order/confirmation carries no code", () => {
  it("clears k from an old confirmation link without saving it", async () => {
    const order = await placeDemoOrder();
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=3&id=${order.id}&k=${CODE}`,
    );
    render(<ConfirmationPage />);
    await screen.findByText("Got it!");
    await waitFor(() =>
      expect(window.location.search).toBe(`?table=3&id=${order.id}`),
    );
    // A shared confirmation link must not give its opener three hours.
    expect(readTableKey(3)).toBeNull();
  });

  it("sends the customer back to the menu without a code", async () => {
    rememberTableKey(3, CODE);
    window.history.replaceState({}, "", "/order/confirmation?table=3");
    render(<ConfirmationPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/order?table=3"));
  });

  it("links a lost order back to the menu without a code", async () => {
    rememberTableKey(3, CODE);
    window.history.replaceState(
      {},
      "",
      "/order/confirmation?table=3&id=no-such-order",
    );
    render(<ConfirmationPage />);
    const link = await screen.findByRole("link", { name: "Start a new order" });
    expect(link).toHaveAttribute("href", "/order?table=3");
  });

  it("keeps showing the live status after the code has run out", async () => {
    const order = await placeDemoOrder();
    rememberTableKey(3, CODE, Date.now() - 4 * HOUR);
    window.history.replaceState(
      {},
      "",
      `/order/confirmation?table=3&id=${order.id}`,
    );
    render(<ConfirmationPage />);
    expect(await screen.findByText("Got it!")).toBeVisible();
    await demoOrderRepo.setStatus(order.id, "ready");
    expect(await screen.findByText(/Ready — a barista/)).toBeVisible();
  });
});

async function signInOwner() {
  await demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );
}

// An order from an open table, so it goes straight to the kitchen and the
// screen shows "Got it!" rather than waiting for the counter.
const placeDemoOrder = () => {
  demoSetTableOpenUntil(3, Date.now() + 3_600_000);
  return demoOrderRepo.create({
    tableNumber: 3,
    items: [{ menuItemId: "m1", name: "Latte", qty: 1, price: 200 }],
    total: 200,
    status: "preparing",
  });
};

async function addAndOpenSheet(user: ReturnType<typeof userEvent.setup>) {
  await menuShown();
  const add = (await screen.findAllByRole("button", { name: /^Add$/ }))[0];
  await user.click(add);
  await user.click(screen.getByRole("button", { name: /View order/ }));
}

async function placeFirstItem(user: ReturnType<typeof userEvent.setup>) {
  await addAndOpenSheet(user);
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /Place order/ }));
}

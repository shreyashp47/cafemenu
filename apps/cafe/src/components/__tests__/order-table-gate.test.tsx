/**
 * /order checks the scanned table against the owner's saved list, not the
 * build-time default. Runs the real page on the demo store (the tests have no
 * Firebase config), with the list saved the way /admin/qr saves it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrderPage from "@/app/order/page";
import { getCafeName } from "@/lib/config";
import { demoAuthRepo, demoConfigRepo } from "@/lib/data/demo";
import { loadDemoState, resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";
import { forgetLastOrder } from "@/lib/order-throttle";
import { forgetTableKeys, readTableKey } from "@/lib/table-keys";

// No router in a unit test: stand in the query string it would read, as the
// useTableQuery tests do.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function openAt(search: string) {
  window.history.replaceState({}, "", `/order${search}`);
  render(<OrderPage />);
}

beforeEach(async () => {
  resetDemoStore();
  forgetTableKeys();
  forgetLastOrder();
  localStorage.clear();
  await demoAuthRepo.signOut();
  window.history.replaceState({}, "", "/order");
});

describe("/order table check", () => {
  it("accepts a table that is only in the saved list", async () => {
    // 9 is outside the 1..6 default, so this passes only if the saved list is
    // what the page checks against.
    await demoConfigRepo.saveTables([1, 2, 3, 9]);
    openAt("?table=9");
    // The menu's header carries the cafe name; the picker does not.
    expect(
      await screen.findByRole("heading", { name: getCafeName() }),
    ).toBeInTheDocument();
    expect(screen.queryByText("That table number looks odd")).toBeNull();
  });

  it("turns away a default table the owner has removed", async () => {
    await demoConfigRepo.saveTables([1, 2, 3, 9]);
    openAt("?table=5");
    expect(
      await screen.findByText("That table number looks odd"),
    ).toBeInTheDocument();
    // No tappable tables: a tapped number cannot carry the table's code, so it
    // would lead to a menu that refuses the order at checkout.
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(
      screen.getByText(/scan the qr code on your table again/i),
    ).toBeVisible();
  });

  it("asks a customer with no table to scan, offering no table buttons", async () => {
    openAt("");
    expect(
      await screen.findByRole("heading", {
        name: "Scan the QR code on your table",
      }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.getByText(/ask at the counter/i)).toBeVisible();
  });
});

describe("/order and the table's QR code", () => {
  it("remembers the code from a scanned link for later", async () => {
    openAt("?table=3&k=ScannedCode1");
    await screen.findByRole("heading", { name: getCafeName() });
    expect(readTableKey(3)).toBe("ScannedCode1");
  });

  it("ignores a code of the wrong shape", async () => {
    openAt("?table=3&k=bad");
    await screen.findByRole("heading", { name: getCafeName() });
    expect(readTableKey(3)).toBeNull();
  });

  it("sends the code with the order, so a coded table accepts it", async () => {
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "ScannedCode1" });
    openAt("?table=3&k=ScannedCode1");
    await placeFirstItem(user);
    // Placed at all proves the code went with it: the table has one.
    await waitFor(() => expect(loadDemoState().orders).toHaveLength(1));
  });

  it("tells a customer who typed the address to scan instead", async () => {
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "ScannedCode1" });
    openAt("?table=3");
    await placeFirstItem(user);
    expect(
      await screen.findByText(
        "To order, please scan the QR code on your table.",
      ),
    ).toBeVisible();
    expect(loadDemoState().orders).toHaveLength(0);
  });

  it("tells a customer with an old card that the link has expired", async () => {
    const user = userEvent.setup();
    await signInOwner();
    await demoConfigRepo.saveTableKeys({ 3: "RenewedCode1" });
    openAt("?table=3&k=OldCardCode1");
    await placeFirstItem(user);
    expect(
      await screen.findByText(
        "This link has expired — please scan the QR code on your table.",
      ),
    ).toBeVisible();
  });
});

async function signInOwner() {
  await demoAuthRepo.signIn(
    DEMO_CREDENTIALS.owner.email,
    DEMO_CREDENTIALS.owner.password,
  );
}

async function placeFirstItem(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: getCafeName() });
  const add = (await screen.findAllByRole("button", { name: /^Add$/ }))[0];
  await user.click(add);
  await user.click(screen.getByRole("button", { name: /View order/ }));
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /Place order/ }));
}

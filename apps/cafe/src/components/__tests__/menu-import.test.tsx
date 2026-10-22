/**
 * Menu import and starter menus on the owner's menu screen (issue #16), on
 * the demo backend: rows checked before anything is written, the good ones
 * in one batch, the bad ones left in the box to fix.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMenuPage from "@/app/admin/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { demoMenuRepo } from "@/lib/data/demo";
import {
  demoReplaceMenu,
  demoSetSite,
  loadDemoState,
  resetDemoStore,
} from "@/lib/data/demo-store";
import { SEED_MENU } from "@/lib/data/seed";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin",
}));

beforeEach(() => {
  resetDemoStore();
});

function renderPage() {
  return render(
    <DataProvider>
      <AdminMenuPage />
    </DataProvider>,
  );
}

const SHEET = [
  "name,category,price,description,available",
  'Oat Flat White,Drinks,210,"Oat milk, double shot",yes',
  "Rye Loaf,Bread,abc,,yes",
  "Cardamom Knot,Bakes,90.50,,no",
  "Masala Chai,Drinks,140,,yes",
  "",
].join("\n");

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Import" }));
  return screen.getByLabelText("Rows to import");
}

describe("menu import", () => {
  it("checks every row, imports the good ones, and keeps the rest to fix", async () => {
    const user = userEvent.setup();
    const importItems = vi.spyOn(demoMenuRepo, "importItems");
    renderPage();
    const box = await openImport(user);
    await user.click(box);
    await user.paste(SHEET);

    expect(screen.getByText("2 rows ready · 2 to fix")).toBeInTheDocument();
    const toFix = screen.getByRole("list", { name: "Rows to fix" });
    expect(within(toFix).getByText("Row 3 · Rye Loaf")).toBeInTheDocument();
    expect(
      within(toFix).getByText(/"abc" isn't a price in ₹/),
    ).toBeInTheDocument();
    expect(within(toFix).getByText("Row 5 · Masala Chai")).toBeInTheDocument();
    expect(within(toFix).getByText("Already on the menu.")).toBeInTheDocument();
    const ready = screen.getByRole("list", { name: "Rows ready" });
    expect(within(ready).getByText("₹210")).toBeInTheDocument();
    expect(within(ready).getByText("₹90.50")).toBeInTheDocument();

    // Fix selects the row in the box.
    await user.click(screen.getByRole("button", { name: "Fix row 3" }));
    const area = box as HTMLTextAreaElement;
    expect(area).toHaveFocus();
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe(
      "Rye Loaf,Bread,abc,,yes",
    );

    await user.click(screen.getByRole("button", { name: "Import 2 items" }));
    expect(importItems).toHaveBeenCalledTimes(1);
    expect(importItems).toHaveBeenCalledWith(
      [
        {
          name: "Oat Flat White",
          category: "Drinks",
          price: 21_000,
          description: "Oat milk, double shot",
          available: true,
        },
        {
          name: "Cardamom Knot",
          category: "Bakes",
          price: 9_050,
          description: "",
          available: false,
        },
      ],
      false,
    );
    expect(
      await screen.findByText("Added 2 items. 2 rows left to fix."),
    ).toBeInTheDocument();
    expect(box).toHaveValue(
      "name,category,price,description,available\nRye Loaf,Bread,abc,,yes\nMasala Chai,Drinks,140,,yes\n",
    );
    // The menu kept everything it had.
    expect(loadDemoState().menu).toHaveLength(SEED_MENU.length + 2);
    expect(await screen.findByText(/14 items/)).toBeInTheDocument();

    // Fixed in the box, the last good row goes in too.
    await user.clear(box);
    await user.click(box);
    await user.paste("Rye Loaf,Bread,300\n");
    await user.click(screen.getByRole("button", { name: "Import 1 item" }));
    expect(await screen.findByText("Added 1 item.")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("replaces the whole menu only when chosen, and asked", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    renderPage();
    const box = await openImport(user);
    await user.click(box);
    await user.paste("Masala Chai,Tea,150\nScone,Bakes,90\n");
    // Adding would repeat a name; replacing would not.
    expect(screen.getByText("1 row ready · 1 to fix")).toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: "Replace them all with these" }),
    );
    expect(screen.getByText("2 rows ready")).toBeInTheDocument();

    const replace = screen.getByRole("button", {
      name: "Replace the menu with 2 items",
    });
    await user.click(replace);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Replace all 12 items on the menu with these 2\?/),
    );
    expect(loadDemoState().menu).toHaveLength(SEED_MENU.length);

    confirm.mockReturnValueOnce(true);
    await user.click(replace);
    expect(
      await screen.findByText("Replaced the menu with 2 items."),
    ).toBeInTheDocument();
    expect(loadDemoState().menu.map((i) => i.name)).toEqual([
      "Masala Chai",
      "Scone",
    ]);
  });

  it("reads a chosen CSV file, BOM and Windows line endings too", async () => {
    const user = userEvent.setup();
    renderPage();
    const box = await openImport(user);
    const file = new File(
      ["﻿name,category,price\r\nRye Loaf,Bread,300\r\n"],
      "menu.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText("Choose a CSV file"), file);
    await waitFor(() =>
      expect((box as HTMLTextAreaElement).value).toContain("Rye"),
    );
    expect(screen.getByText("1 row ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 1 item" })).toBeEnabled();
  });

  it("checks prices in the cafe's currency: whole yen", async () => {
    const user = userEvent.setup();
    act(() => demoSetSite({ currency: "JPY", locale: "ja-JP" }));
    renderPage();
    const box = await openImport(user);
    await user.click(box);
    await user.paste("Matcha,Tea,¥650\nMochi,Sweets,4.50\n");
    expect(screen.getByText("1 row ready · 1 to fix")).toBeInTheDocument();
    expect(
      screen.getByText(/"4.50" isn't a price in [¥￥]: use a whole number/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Rows ready" })).getByText(
        /[¥￥]650/,
      ),
    ).toBeInTheDocument();
  });
});

describe("starter menus", () => {
  it("are offered on an empty menu, shown in full, then added", async () => {
    const user = userEvent.setup();
    act(() => demoReplaceMenu([]));
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: /^Coffee shop/ }),
    );
    // Shown, checked and editable before anything is written.
    expect(
      (screen.getByLabelText("Rows to import") as HTMLTextAreaElement).value,
    ).toContain("Cappuccino,Coffee,180.00,");
    expect(screen.getByText("16 rows ready")).toBeInTheDocument();
    expect(loadDemoState().menu).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Import 16 items" }));
    expect(await screen.findByText(/16 items · all available/)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Add a starter menu" }),
    ).not.toBeInTheDocument();
    expect(
      loadDemoState().menu.find((i) => i.name === "Cappuccino"),
    ).toMatchObject({
      category: "Coffee",
      price: 18_000,
    });
  });

  it("leave prices to the owner in a currency with no price level", async () => {
    const user = userEvent.setup();
    act(() => {
      demoReplaceMenu([]);
      demoSetSite({ currency: "THB", locale: "th-TH" });
    });
    renderPage();
    expect(
      await screen.findByText(/Prices are left empty for THB/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Bakery/ }));
    expect(screen.getByText("0 rows ready · 16 to fix")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import 0 items" }),
    ).toBeDisabled();
  });
});

/**
 * The owner's menu screen, on the demo backend: compact rows, one-tap
 * sold-out switch, an editor that opens for one item at a time.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMenuPage from "@/app/admin/page";
import { DataProvider } from "@/components/providers/DataProvider";
import { demoMenuRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";

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

const editButton = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^Edit ${name}`) });

describe("owner menu page", () => {
  it("shows a summary and no decorative feature tiles", async () => {
    renderPage();
    expect(
      await screen.findByText(/12 items · 1 sold out/),
    ).toBeInTheDocument();
    for (const tile of [
      "Edit anything",
      "Live instantly",
      "Monthly reports",
      "Table QR codes",
    ]) {
      expect(screen.queryByText(tile)).not.toBeInTheDocument();
    }
  });

  it("lists items as compact rows with no edit fields until asked", async () => {
    renderPage();
    const edit = await editButton("Masala Chai");
    expect(edit).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Sold out : Soft Serve Cone/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("marks an item sold out with one tap on its switch", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(demoMenuRepo, "update");
    renderPage();
    const sw = await screen.findByRole("switch", {
      name: /Available : Masala Chai/,
    });
    await user.click(sw);
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      available: false,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: /Masala Chai/ }),
      ).toHaveAttribute("aria-checked", "false"),
    );
    expect(screen.getByText(/2 sold out/)).toBeInTheDocument();
  });

  it("opens the editor, saves a change, and closes", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(demoMenuRepo, "update");
    renderPage();
    await user.click(await editButton("Masala Chai"));

    const form = screen.getByRole("form", { name: "Edit Masala Chai" });
    const save = within(form).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing changed yet

    const price = within(form).getByLabelText("Price (₹)");
    await user.clear(price);
    await user.type(price, "150");
    await user.click(save);

    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "Masala Chai", price: 150 }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit Masala Chai" }),
      ).not.toBeInTheDocument(),
    );
    expect(await editButton("Masala Chai")).toHaveTextContent("₹150");
  });

  it("cancel throws the draft away without saving", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(demoMenuRepo, "update");
    renderPage();
    await user.click(await editButton("Masala Chai"));
    const form = screen.getByRole("form", { name: "Edit Masala Chai" });
    await user.type(within(form).getByLabelText("Name"), " Deluxe");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await user.click(await editButton("Masala Chai"));
    expect(screen.getByLabelText("Name")).toHaveValue("Masala Chai");
  });

  it("keeps only one editor open", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await editButton("Masala Chai"));
    await user.click(await editButton("Cappuccino"));
    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(
      screen.getByRole("form", { name: "Edit Cappuccino" }),
    ).toBeInTheDocument();
  });

  it("asks before deleting, and keeps the item if the owner says no", async () => {
    const user = userEvent.setup();
    const remove = vi.spyOn(demoMenuRepo, "remove");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await user.click(await editButton("Masala Chai"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Edit Masala Chai/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens the add form on demand and confirms the new item", async () => {
    const user = userEvent.setup();
    renderPage();
    const add = await screen.findByRole("button", { name: "Add item" });
    expect(screen.queryByLabelText("Price (₹)")).not.toBeInTheDocument();
    await user.click(add);

    await user.type(screen.getByLabelText("Name"), "Cardamom Bun");
    await user.type(screen.getByLabelText("Price (₹)"), "90");
    await user.click(screen.getByRole("button", { name: "Add to menu" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Added “Cardamom Bun”/,
    );
    expect(await editButton("Cardamom Bun")).toBeInTheDocument();
    expect(screen.getByText(/13 items/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Price (₹)")).not.toBeInTheDocument();
  });

  it("labels the today's-special switch", async () => {
    renderPage();
    expect(
      await screen.findByRole("switch", { name: "Show to customers" }),
    ).toBeInTheDocument();
  });
});

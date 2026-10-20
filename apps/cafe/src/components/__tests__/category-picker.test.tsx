/**
 * The owner's add-item form could not change category: every keystroke was
 * snapped back to the first existing one. These drive the picker the way the
 * owner does, through a parent that holds the value like the form does.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { CategoryPicker } from "@/components/CategoryPicker";

// Mirrors how the add-item form derives its category from the picker.
function Harness({ categories }: { categories: string[] }) {
  const [picked, setPicked] = useState<{ name: string; isNew: boolean } | null>(
    null,
  );
  const value =
    picked && (picked.isNew || categories.includes(picked.name))
      ? picked.name
      : (categories[0] ?? "");
  return (
    <>
      <label htmlFor="cat">Category</label>
      <CategoryPicker
        id="cat"
        categories={categories}
        value={value}
        onChange={(name, isNew) => setPicked({ name, isNew })}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const CATEGORIES = ["Bakes", "Coffee", "Tea"];

describe("CategoryPicker", () => {
  it("starts on the first existing category", () => {
    render(<Harness categories={CATEGORIES} />);
    expect(screen.getByLabelText("Category")).toHaveValue("Bakes");
    expect(screen.getByTestId("value")).toHaveTextContent("Bakes");
  });

  it("switches to another existing category", async () => {
    const user = userEvent.setup();
    render(<Harness categories={CATEGORIES} />);
    await user.selectOptions(screen.getByLabelText("Category"), "Tea");
    expect(screen.getByTestId("value")).toHaveTextContent("Tea");
    expect(screen.queryByLabelText("New category name")).toBeNull();
  });

  it("takes a new category, letter by letter, without snapping back", async () => {
    const user = userEvent.setup();
    render(<Harness categories={CATEGORIES} />);
    await user.selectOptions(
      screen.getByLabelText("Category"),
      "New category…",
    );
    const name = screen.getByLabelText("New category name");
    expect(name).toHaveValue("");
    await user.type(name, "Sandwiches");
    await user.type(name, "{backspace}");
    expect(name).toHaveValue("Sandwiche");
    expect(screen.getByTestId("value")).toHaveTextContent("Sandwiche");
  });

  it("goes back to an existing category after starting a new one", async () => {
    const user = userEvent.setup();
    render(<Harness categories={CATEGORIES} />);
    const select = screen.getByLabelText("Category");
    await user.selectOptions(select, "New category…");
    await user.type(screen.getByLabelText("New category name"), "Soup");
    await user.selectOptions(select, "Coffee");
    expect(screen.getByTestId("value")).toHaveTextContent("Coffee");
    expect(screen.queryByLabelText("New category name")).toBeNull();
  });

  it("is a plain text box when the menu has no categories yet", async () => {
    const user = userEvent.setup();
    render(<Harness categories={[]} />);
    const input = screen.getByLabelText("Category");
    expect(input.tagName).toBe("INPUT");
    await user.type(input, "Drinks");
    expect(screen.getByTestId("value")).toHaveTextContent("Drinks");
  });

  it("falls back to the first category when the picked one leaves the menu", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness categories={CATEGORIES} />);
    await user.selectOptions(screen.getByLabelText("Category"), "Tea");
    rerender(<Harness categories={["Bakes", "Coffee"]} />);
    expect(screen.getByLabelText("Category")).toHaveValue("Bakes");
    expect(screen.getByTestId("value")).toHaveTextContent("Bakes");
  });
});

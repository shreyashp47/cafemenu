/**
 * The owner's table control on /admin/qr. Driven the way the owner uses it:
 * the − and + buttons, typing a number, switching to a typed-out list, and
 * saving, including a save that fails.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TableListEditor } from "@/components/TableListEditor";

function setup(props: Partial<Parameters<typeof TableListEditor>[0]> = {}) {
  const onSave = vi.fn(async (tables: number[]) => {
    void tables;
  });
  const user = userEvent.setup();
  const view = render(
    <TableListEditor
      tables={[1, 2, 3, 4, 5, 6]}
      saved={[1, 2, 3, 4, 5, 6]}
      loading={false}
      onSave={onSave}
      {...props}
    />,
  );
  return { user, onSave, ...view };
}

const saveButton = () => screen.getByRole("button", { name: "Save tables" });

describe("TableListEditor", () => {
  it("shows a loader, not a guess, while the saved list loads", () => {
    setup({ loading: true });
    expect(screen.getByText("Loading your tables…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Number of tables")).toBeNull();
  });

  it("opens on the number of tables when they run 1..N", () => {
    setup();
    expect(screen.getByLabelText("Number of tables")).toHaveValue(6);
    // Nothing changed, so nothing to save.
    expect(saveButton()).toBeDisabled();
  });

  it("steps the count and saves tables 1..N", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "One table more" }));
    await user.click(screen.getByRole("button", { name: "One table more" }));
    expect(screen.getByLabelText("Number of tables")).toHaveValue(8);
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("will not step below 1 table", () => {
    setup({ tables: [1], saved: [1] });
    expect(
      screen.getByRole("button", { name: "One table fewer" }),
    ).toBeDisabled();
  });

  it("refuses a typed count outside 1..50", async () => {
    const { user, onSave } = setup();
    const input = screen.getByLabelText("Number of tables");
    await user.clear(input);
    await user.type(input, "51");
    expect(screen.getByRole("alert")).toHaveTextContent("from 1 to 50");
    expect(saveButton()).toBeDisabled();
    await user.clear(input);
    expect(saveButton()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens on the typed-out list when the tables skip numbers", () => {
    setup({ tables: [1, 2, 3, 12, 14], saved: [1, 2, 3, 12, 14] });
    expect(screen.getByLabelText("Table numbers")).toHaveValue("1-3, 12, 14");
  });

  it("saves a typed-out list with ranges", async () => {
    const { user, onSave } = setup();
    await user.click(
      screen.getByRole("button", { name: /Type the table numbers instead/ }),
    );
    const input = screen.getByLabelText("Table numbers");
    expect(input).toHaveValue("1-6");
    await user.clear(input);
    await user.type(input, "1-4, 12, 14");
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([1, 2, 3, 4, 12, 14]);
  });

  it("names the part of a typed list it cannot use", async () => {
    const { user } = setup({ tables: [1, 3], saved: [1, 3] });
    const input = screen.getByLabelText("Table numbers");
    await user.type(input, ", 60, bar");
    expect(screen.getByRole("alert")).toHaveTextContent('"60", "bar"');
    expect(saveButton()).toBeDisabled();
  });

  it("switches back to a plain count", async () => {
    const { user } = setup({ tables: [1, 3], saved: [1, 3] });
    await user.click(
      screen.getByRole("button", { name: /Just number my tables/ }),
    );
    expect(screen.getByLabelText("Number of tables")).toHaveValue(2);
  });

  it("says when a save fails, and keeps the owner's edit", async () => {
    const { user, onSave } = setup();
    onSave.mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "One table more" }));
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't save");
    expect(screen.getByLabelText("Number of tables")).toHaveValue(7);
  });

  it("lets the owner pin the default by saving it unchanged", async () => {
    const { user, onSave } = setup({ saved: null });
    expect(screen.getByText(/Using the default \(1-6\)/)).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
  });

  it("follows a list saved elsewhere while untouched", () => {
    const { rerender, onSave } = setup();
    rerender(
      <TableListEditor
        tables={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
        saved={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
        loading={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Number of tables")).toHaveValue(9);
  });
});

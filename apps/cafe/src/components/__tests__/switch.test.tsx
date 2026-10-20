/**
 * The owner's Available / Sold out control used to hide its own label under a
 * knob that sat outside the track. The switch must say what it is, say its
 * state, and flip on a tap.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "@/components/ui/Switch";

function Harness() {
  const [on, setOn] = useState(true);
  return (
    <Switch
      checked={on}
      onChange={setOn}
      label={on ? "Available" : "Sold out"}
      srContext=": Masala Chai"
    />
  );
}

describe("Switch", () => {
  it("is a switch named by its visible label and context", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Available : Masala Chai" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Available")).toBeVisible();
  });

  it("toggles on click and on the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sw = screen.getByRole("switch");
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveAccessibleName("Sold out : Masala Chai");
    sw.focus();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("reports the next state and does nothing while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onChange={onChange} label="Show to customers" />,
    );
    await user.click(screen.getByRole("switch", { name: "Show to customers" }));
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    rerender(
      <Switch
        checked={false}
        onChange={onChange}
        label="Show to customers"
        disabled
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the knob inside the track", () => {
    render(<Switch checked onChange={() => {}} label="On" />);
    const knob = screen.getByRole("switch").querySelector("span > span");
    expect(knob?.className).toContain("left-0.5");
    expect(knob?.className).toContain("translate-x-4");
  });
});

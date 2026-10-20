/**
 * The owner's "Orders | Owner" switch: the one labelled way between the order
 * board and the owner dashboard. Staff must never see it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StaffPage from "@/app/staff/page";
import { OwnerSwitch } from "@/components/OwnerSwitch";
import { demoAuthRepo } from "@/lib/data/demo";
import { resetDemoStore } from "@/lib/data/demo-store";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/staff",
}));

beforeEach(async () => {
  replace.mockClear();
  resetDemoStore();
  await demoAuthRepo.signOut();
});

describe("OwnerSwitch", () => {
  it("gives the owner both screens, labelled, with the right links", () => {
    render(<OwnerSwitch role="owner" current="orders" />);

    const nav = screen.getByRole("navigation", { name: "Switch screen" });
    expect(nav).toBeInTheDocument();

    const orders = screen.getByRole("link", { name: "Orders" });
    const owner = screen.getByRole("link", { name: "Owner" });
    expect(orders).toHaveAttribute("href", "/staff");
    expect(owner).toHaveAttribute("href", "/admin");
  });

  it("marks the order board as current on /staff", () => {
    render(<OwnerSwitch role="owner" current="orders" />);
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Owner" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the owner dashboard as current on /admin", () => {
    render(<OwnerSwitch role="owner" current="owner" />);
    expect(screen.getByRole("link", { name: "Owner" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Orders" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(["staff", "unassigned", undefined] as const)(
    "renders nothing for role %s",
    (role) => {
      const { container } = render(
        <OwnerSwitch role={role} current="orders" />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );
});

describe("order board header (demo backend)", () => {
  it("shows the owner the switch, with Orders current", async () => {
    const { email, password } = DEMO_CREDENTIALS.owner;
    await demoAuthRepo.signIn(email, password);
    render(<StaffPage />);

    const orders = await screen.findByRole("link", { name: "Orders" });
    expect(orders).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Owner" })).toHaveAttribute(
      "href",
      "/admin",
    );
    // Already signed in, e.g. back from the dashboard via the switch: stay here.
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a barista the same board with no switch", async () => {
    const { email, password } = DEMO_CREDENTIALS.staff;
    await demoAuthRepo.signIn(email, password);
    render(<StaffPage />);

    await screen.findByRole("heading", { name: "Order board" });
    expect(
      screen.queryByRole("navigation", { name: "Switch screen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Owner" }),
    ).not.toBeInTheDocument();
  });
});

describe("signing in on the order board", () => {
  async function signInThroughTheForm(which: "staff" | "owner") {
    const user = userEvent.setup();
    render(<StaffPage />);
    await user.click(
      await screen.findByRole("button", {
        name: which === "owner" ? "Fill owner" : "Fill staff",
      }),
    );
    await user.click(screen.getByRole("button", { name: /sign in/i }));
  }

  it("sends the owner to the dashboard", async () => {
    await signInThroughTheForm("owner");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });

  it("keeps a barista on the order board", async () => {
    await signInThroughTheForm("staff");
    await screen.findByRole("heading", { name: "Order board" });
    expect(replace).not.toHaveBeenCalled();
  });
});

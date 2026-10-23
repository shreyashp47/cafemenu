/**
 * Sign-up as an owner goes through it, in demo mode: the form, its
 * problems, the email step, and the draft cafe it leaves.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { load, resetDemo } from "@/lib/data/demo-store";
import { DRAFT_STORAGE_KEY } from "@/lib/signup/draft";
import { SignupFlow } from "../SignupFlow";

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => resetDemo());

describe("signing up", () => {
  it("names what is missing and takes the focus to the first of it", async () => {
    render(<SignupFlow />);
    fireEvent.click(
      await screen.findByRole("button", { name: /create account/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/fields marked/);
    expect(screen.getByLabelText("Cafe name")).toHaveFocus();
    expect(screen.getByLabelText("Cafe name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Give your cafe's name.")).toBeInTheDocument();
  });

  it("makes the account, waits for the link, then saves a draft cafe", async () => {
    render(<SignupFlow />);
    type("Cafe name", "Lantern Café");
    expect(screen.getByLabelText("Web address")).toHaveValue("lantern-cafe");
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "IN" },
    });
    expect(screen.getByLabelText("Currency")).toHaveValue("INR");
    expect(screen.getByLabelText("Where your data is kept")).toHaveValue(
      "asia-south1",
    );
    type("Email", "owner@lantern.test");
    type(/^Password/, "correct-horse");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(load().cafes).toEqual([]);
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).not.toContain(
      "correct-horse",
    );

    // Not yet: the rules would refuse the cafe.
    fireEvent.click(
      screen.getByRole("button", { name: "I've clicked the link" }),
    );
    expect(await screen.findByText(/Not confirmed yet/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Pretend I clicked the link" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Lantern Café is saved." }),
    ).toBeInTheDocument();
    await waitFor(() => expect(load().cafes).toHaveLength(1));
    expect(load().cafes[0]).toMatchObject({
      site: "lantern-cafe",
      region: "asia-south1",
      status: "draft",
      settings: {
        name: "Lantern Café",
        currency: "INR",
        tables: [1, 2, 3, 4, 5, 6],
      },
    });
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("comes back to the email step after a reload", async () => {
    const first = render(<SignupFlow />);
    type("Cafe name", "Lantern");
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "IN" },
    });
    type("Email", "owner@lantern.test");
    type(/^Password/, "correct-horse");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByRole("heading", { name: "Check your email" });
    first.unmount();

    render(<SignupFlow />);
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    // Starting again keeps what was typed.
    fireEvent.click(screen.getByRole("button", { name: /start again/i }));
    expect(await screen.findByLabelText("Cafe name")).toHaveValue("Lantern");
  });
});

/**
 * Onboarding as an owner goes through it, in demo mode: creating the
 * project, giving access, a check that fails and one that passes, and
 * coming back to the same step.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { newCafeSettings } from "@cafemenu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_DEPLOY_ACCOUNT } from "@/lib/config";
import { demoBundle, demoVerifyEmail } from "@/lib/data/demo";
import { load, resetDemo } from "@/lib/data/demo-store";
import { SetupFlow } from "../SetupFlow";

const SLOW = { timeout: 3000 };

async function ownerWithDraft() {
  await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
  demoVerifyEmail();
  return demoBundle.cafes.create({
    site: "lantern-cafe",
    region: "asia-south1",
    settings: newCafeSettings({ name: "Lantern Café" }),
  });
}

const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const projectId = (value: string) =>
  fireEvent.change(screen.getByLabelText("Your project's ID"), {
    target: { value },
  });

beforeEach(() => resetDemo());

describe("onboarding", () => {
  it("asks a signed-out owner to sign in, and carries on", async () => {
    await ownerWithDraft();
    await demoBundle.auth.signOut();
    render(<SetupFlow />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "owner@lantern.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse" },
    });
    press("Sign in");
    expect(
      await screen.findByRole("heading", { name: "Create a Firebase project" }),
    ).toBeInTheDocument();
  });

  it("goes from the project to access, checks, and connects", async () => {
    const cafe = await ownerWithDraft();
    render(<SetupFlow />);
    await screen.findByRole("heading", { name: "Create a Firebase project" });
    expect(screen.getAllByText(/SPIKE #3: screenshot/)).toHaveLength(2);
    press("I've created the project");
    expect(
      await screen.findByRole("heading", { name: "Give CafeMenu access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Give CafeMenu access" }),
    ).toHaveFocus();

    // The address to paste, the role still to be settled, and where the
    // member can really be seen.
    expect(screen.getByText(DEMO_DEPLOY_ACCOUNT)).toBeInTheDocument();
    expect(screen.getByText(/SPIKE #3: the exact role/)).toBeInTheDocument();
    expect(
      screen.getByText("It won't appear in that list."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Google Cloud IAM page/ }),
    ).toHaveAttribute("href", "https://console.cloud.google.com/iam-admin/iam");

    // Nothing to check yet.
    press("Check connection");
    expect(
      screen.getByText(/doesn't look like a Firebase project ID/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Your project's ID")).toHaveFocus();

    // A role that is too small: each missing permission, named.
    projectId("lantern-missing");
    press("Check connection");
    expect(
      await screen.findByText(/its role doesn't allow everything/, {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByText("datastore.databases.create")).toBeInTheDocument();
    // The ID was saved on the cafe before the check.
    expect(load().cafes.find((c) => c.id === cafe.id)?.projectId).toBe(
      "lantern-missing",
    );
    // Both links to IAM, the note's and the fix's, open this project.
    for (const link of screen.getAllByRole("link", {
      name: /Google Cloud IAM page/,
    })) {
      expect(link).toHaveAttribute(
        "href",
        "https://console.cloud.google.com/iam-admin/iam?project=lantern-missing",
      );
    }

    projectId("Lantern-Cafe-1A2B");
    press("Check connection");
    expect(
      await screen.findByRole(
        "heading",
        { name: "Lantern Café is connected" },
        SLOW,
      ),
    ).toBeInTheDocument();
    expect(load().cafes.find((c) => c.id === cafe.id)?.projectId).toBe(
      "lantern-cafe-1a2b",
    );
  });

  it("comes back to the step it left", async () => {
    await ownerWithDraft();
    const first = render(<SetupFlow />);
    await screen.findByRole("heading", { name: "Create a Firebase project" });
    press("I've created the project");
    await screen.findByRole("heading", { name: "Give CafeMenu access" });
    projectId("lantern-noaccess");
    press("Check connection");
    await screen.findByText(/can't reach/, {}, SLOW);
    first.unmount();

    render(<SetupFlow />);
    expect(
      await screen.findByRole("heading", { name: "Give CafeMenu access" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Your project's ID")).toHaveValue(
      "lantern-noaccess",
    );
    expect(screen.getByText(/can't reach/)).toBeInTheDocument();
  });

  it("says when there is no cafe, or the email is not confirmed", async () => {
    await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
    const unverified = render(<SetupFlow />);
    expect(
      await screen.findByRole("heading", { name: "Confirm your email first" }),
    ).toBeInTheDocument();
    unverified.unmount();
    demoVerifyEmail();
    render(<SetupFlow />);
    expect(
      await screen.findByRole("heading", { name: "No cafe to set up yet" }),
    ).toBeInTheDocument();
  });
});

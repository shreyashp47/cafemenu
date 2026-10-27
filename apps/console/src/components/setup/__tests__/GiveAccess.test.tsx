import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WizardState } from "@/lib/setup/wizard";
import { GiveAccess } from "../GiveAccess";

const checking: WizardState = {
  step: "access",
  projectId: "lantern-cafe-1a2b",
  check: { status: "checking", projectId: "lantern-cafe-1a2b" },
};

const show = (props: Partial<Parameters<typeof GiveAccess>[0]> = {}) =>
  render(
    <GiveAccess
      state={checking}
      demo={false}
      focus={false}
      onProjectId={() => {}}
      onCheck={() => {}}
      onBack={() => {}}
      {...props}
    />,
  );

describe("Check connection, when the backend answers in minutes", () => {
  it("says it takes a few minutes while it waits for the next run", () => {
    show({ slow: true });
    expect(screen.getByRole("button", { name: /Checking/ })).toBeDisabled();
    expect(screen.getByText(/takes a few minutes/)).toBeInTheDocument();
    expect(screen.queryByText(/checking your project now/)).toBeNull();
  });

  it("shows live progress once a worker has it", () => {
    show({
      slow: true,
      progress: {
        status: "running",
        detail: "Testing the permissions",
        steps: [
          { id: "check", label: "Check CafeMenu's access", status: "running" },
        ],
      },
    });
    expect(
      screen.getByText(/CafeMenu is checking your project now/),
    ).toBeInTheDocument();
    expect(screen.getByText("Testing the permissions")).toBeInTheDocument();
    expect(screen.getByText("Check CafeMenu's access")).toBeInTheDocument();
    expect(screen.queryByText(/takes a few minutes/)).toBeNull();
  });

  it("says nothing of waiting when the answer is quick", () => {
    show({ slow: false });
    expect(screen.queryByText(/takes a few minutes/)).toBeNull();
  });
});

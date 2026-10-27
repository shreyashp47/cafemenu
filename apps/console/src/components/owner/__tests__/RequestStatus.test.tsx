import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BackendRequest } from "@/lib/platform/model";
import type { RequestStage } from "@/lib/owner/requests";
import { RequestStatus } from "../RequestStatus";

const request = (fields: Partial<BackendRequest> = {}): BackendRequest => ({
  id: "r1",
  cafeId: "cafe1",
  ownerUid: "owner1",
  kind: "deploy",
  status: "queued",
  steps: [],
  detail: null,
  result: null,
  error: null,
  errorCode: null,
  deploymentId: null,
  createdAt: 1,
  finishedAt: null,
  ...fields,
});

const show = (stage: RequestStage, fields?: Partial<BackendRequest>) =>
  render(<RequestStatus view={{ request: request(fields), stage }} />);

describe("a request the backend has not finished", () => {
  it("says it takes a few minutes while it waits for the next run", () => {
    show("waiting");
    const card = screen.getByRole("status", { name: "Upgrade on its way" });
    expect(card).toHaveTextContent("This takes a few minutes");
    expect(card).toHaveTextContent("Waiting for CafeMenu's next run");
  });

  it("says the updates may be paused when it has waited too long", () => {
    show("late");
    expect(screen.getByRole("status")).toHaveTextContent(
      "taking longer than usual",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "nothing on your site has been changed yet",
    );
  });

  it("shows live progress: what it is doing and each step", () => {
    show("working", {
      kind: "rollback",
      status: "running",
      detail: "Firestore rules",
      steps: [
        { id: "schema", label: "Check the data's schema", status: "done" },
        { id: "rules", label: "Firestore rules", status: "running" },
        { id: "hosting", label: "Hosting", status: "pending" },
      ],
    });
    const card = screen.getByRole("status", { name: "Roll back on its way" });
    expect(card).toHaveTextContent("CafeMenu is working on it now");
    expect(card).toHaveTextContent("Firestore rules");
    expect(
      screen.getByRole("list", { name: "Steps" }).querySelectorAll("li"),
    ).toHaveLength(3);
    expect(screen.getByText("(done)")).toBeInTheDocument();
    expect(screen.getByText("(running)")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("takes a few minutes");
  });

  it("says why it didn't go through, in the worker's words", () => {
    show("failed", {
      status: "failed",
      kind: "sync-branding",
      error: "Another deployment is queued or running for this cafe.",
    });
    const card = screen.getByRole("status", { name: "Branding on its way" });
    expect(card).toHaveTextContent("It didn't go through");
    expect(card).toHaveTextContent("Another deployment is queued or running");
    show("failed", { status: "failed" });
    expect(screen.getAllByRole("status")[1]).toHaveTextContent(
      "It didn't go through, and nothing on your site was changed by it.",
    );
  });
});

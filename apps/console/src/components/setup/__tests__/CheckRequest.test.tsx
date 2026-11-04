/**
 * Check connection when the backend runs on GitHub Actions (#77): the check
 * is a request the backend picks up on its next run, so the page says it
 * takes a few minutes, follows it, and moves on when it is answered.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it, vi } from "vitest";
import { requestConnectionChecker } from "@/lib/data/requests";
import type { DataBundle } from "@/lib/data/types";
import type { Cafe } from "@/lib/platform/model";
import { fakeRequests } from "@/test/requests";
import { SetupWizard } from "../SetupWizard";

const cafe: Cafe = {
  id: "c1",
  ownerUid: "u1",
  ownerEmail: "owner@lantern.test",
  projectId: null,
  site: "lantern-cafe",
  region: "asia-south1",
  settings: newCafeSettings({ name: "Lantern Café" }),
  release: { channel: "stable", pinned: null, current: null, previous: null },
  status: "draft",
  createdAt: 0,
  updatedAt: 0,
};

function wizard() {
  const fake = fakeRequests();
  const data = {
    backend: "firebase",
    cafes: { connectProject: vi.fn(async () => {}) },
    connection: requestConnectionChecker(fake.repo),
    requests: fake.repo,
  } as unknown as DataBundle;
  render(<SetupWizard data={data} cafe={cafe} />);
  fireEvent.click(
    screen.getByRole("button", { name: "I've created the project" }),
  );
  fireEvent.change(screen.getByLabelText("Your project's ID"), {
    target: { value: "lantern-cafe-1a2b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  return { data, fake };
}

describe("a check that is a request", () => {
  it("says it takes a few minutes, follows the request, and connects when answered", async () => {
    const { data, fake } = wizard();
    expect(
      await screen.findByText(/This takes a few minutes/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Waiting for CafeMenu to pick your check up…"),
    ).toBeInTheDocument();
    expect(data.cafes.connectProject).toHaveBeenCalledWith(
      "c1",
      "lantern-cafe-1a2b",
    );
    const asked = fake.last()!;
    expect(asked).toMatchObject({
      kind: "check",
      params: { projectId: "lantern-cafe-1a2b" },
    });

    act(() => fake.answer(asked.id, { status: "running" }));
    expect(
      screen.getByText("CafeMenu is checking your project now…"),
    ).toBeInTheDocument();

    act(() =>
      fake.answer(asked.id, {
        status: "done",
        result: { status: "connected" },
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Lantern Café is connected" }),
    ).toBeInTheDocument();
  });

  it("says why when the backend couldn't check", async () => {
    const { fake } = wizard();
    await screen.findByText(/This takes a few minutes/);
    act(() =>
      fake.answer(fake.last()!.id, {
        status: "failed",
        errorCode: "unavailable",
        error: "Google didn't answer just now.",
      }),
    );
    expect(
      await screen.findByText(/CafeMenu couldn't reach Google just now/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This takes a few minutes/)).toBeNull();
  });
});

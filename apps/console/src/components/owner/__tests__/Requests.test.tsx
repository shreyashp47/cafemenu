/**
 * The owner area when the backend runs on GitHub Actions (#77): Upgrade,
 * Roll back and Save branding write a request, the page says it takes a few
 * minutes, and the request shows live until the backend has made it a
 * deployment, or refused it with its reason.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it, vi } from "vitest";
import { requestDeployRequests } from "@/lib/data/requests";
import type { DataBundle } from "@/lib/data/types";
import type { BackendRequest, Cafe, Release } from "@/lib/platform/model";
import { fakeRequests } from "@/test/requests";
import { BrandingPanel } from "../BrandingPanel";
import { RequestList } from "../RequestList";
import { UpdatesPanel } from "../UpdatesPanel";

const release = (version: string): Release => ({
  version,
  channel: "stable",
  notes: `Notes for ${version}.`,
  publishedAt: Date.parse("2026-10-01T00:00:00Z"),
  schemaVersion: 2,
  withdrawn: false,
});

const cafe: Cafe = {
  id: "c1",
  ownerUid: "u1",
  ownerEmail: "owner@lantern.test",
  projectId: "lantern-cafe-1a2b",
  site: "lantern-cafe",
  region: "asia-south1",
  settings: newCafeSettings({
    name: "Lantern Café",
    currency: "INR",
    locale: "en-IN",
    timeZone: "Asia/Kolkata",
  }),
  release: {
    channel: "stable",
    pinned: null,
    current: "1.1.0",
    previous: "1.0.0",
  },
  status: "live",
  createdAt: 0,
  updatedAt: 0,
};

function bundle() {
  const fake = fakeRequests();
  const data = {
    releases: { list: async () => [release("1.2.0"), release("1.1.0")] },
    cafes: {
      chooseRelease: vi.fn(async () => {}),
      updateSettings: vi.fn(async () => {}),
    },
    setup: { getLogo: async () => null },
    deploys: requestDeployRequests(fake.repo),
    requests: fake.repo,
  } as unknown as DataBundle;
  return { data, fake };
}

const request = (over: Partial<BackendRequest> = {}): BackendRequest => ({
  id: "r1",
  cafeId: "c1",
  kind: "deploy",
  params: { version: "1.2.0" },
  status: "queued",
  by: "u1",
  createdAt: Date.parse("2026-10-27T09:00:00Z"),
  progress: null,
  result: null,
  error: null,
  errorCode: null,
  deploymentId: null,
  finishedAt: null,
  ...over,
});

describe("Upgrade, as a request", () => {
  it("says it takes a few minutes, and shows the request waiting, with the buttons held", async () => {
    const { data, fake } = bundle();
    const { rerender } = render(
      <UpdatesPanel data={data} cafe={cafe} deployments={[]} requests={[]} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Upgrade to 1.2.0" }),
    );
    expect(
      await screen.findByText(/^Asked\. This takes a few minutes/),
    ).toBeInTheDocument();
    expect(fake.last()).toMatchObject({
      kind: "deploy",
      params: { version: "1.2.0" },
    });

    // What the page's watch on the requests then hands down.
    rerender(
      <UpdatesPanel
        data={data}
        cafe={cafe}
        deployments={[]}
        requests={[fake.last()!]}
      />,
    );
    const list = screen.getByRole("status", { name: "Requests" });
    expect(list).toHaveTextContent("Upgrade to 1.2.0");
    expect(list).toHaveTextContent(
      /Waiting for CafeMenu\. This takes a few minutes/,
    );
    expect(
      screen.getByRole("button", { name: "Upgrade to 1.2.0" }),
    ).toBeDisabled();
  });

  it("shows the backend's reason when it refused", () => {
    render(
      <RequestList
        requests={[
          request({
            status: "failed",
            errorCode: "failed-precondition",
            error: "Another deployment is queued or running for this cafe.",
          }),
        ]}
      />,
    );
    const list = screen.getByRole("status", { name: "Requests" });
    expect(within(list).getByText("Not done")).toBeInTheDocument();
    expect(list).toHaveTextContent(
      "Why: Another deployment is queued or running for this cafe.",
    );
  });

  it("says what is happening once the backend has started", () => {
    render(
      <RequestList
        requests={[
          request({
            kind: "rollback",
            params: {},
            status: "running",
            progress: { steps: [], detail: "Checking who asked" },
          }),
        ]}
      />,
    );
    const list = screen.getByRole("status", { name: "Requests" });
    expect(list).toHaveTextContent("Roll back");
    expect(list).toHaveTextContent("Starting now…");
    expect(list).toHaveTextContent("Checking who asked");
  });

  it("shows nothing when nothing is waiting", () => {
    const { container } = render(<RequestList requests={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Save branding, as a request", () => {
  it("saves, then says the site is updated in a few minutes", async () => {
    const { data, fake } = bundle();
    render(<BrandingPanel data={data} cafe={cafe} deployments={[]} />);
    fireEvent.change(screen.getByLabelText("Cafe name"), {
      target: { value: "Lantern House" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and update my site" }),
    );
    expect(
      await screen.findByText(/Your site will be updated in a few minutes/),
    ).toBeInTheDocument();
    expect(data.cafes.updateSettings).toHaveBeenCalled();
    await waitFor(() => expect(fake.last()?.kind).toBe("sync-branding"));
  });

  it("holds Save while a request is waiting", () => {
    const { data } = bundle();
    render(
      <BrandingPanel
        data={data}
        cafe={cafe}
        deployments={[]}
        requests={[request({ kind: "sync-branding", params: {} })]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save and update my site" }),
    ).toBeDisabled();
  });
});

/**
 * The support-window notice in the Updates section (#35): shown to a cafe that
 * stays on a line CafeMenu no longer supports, with the date to upgrade by.
 */

import { render, screen } from "@testing-library/react";
import { newCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import type { DataBundle } from "@/lib/data/types";
import type { Cafe, Release } from "@/lib/platform/model";
import { UpdatesPanel } from "../UpdatesPanel";

const at = (iso: string) => Date.parse(iso);

const published = (version: string, date: string): Release => ({
  version,
  channel: "stable",
  notes: "",
  publishedAt: at(date),
  schemaVersion: 2,
  withdrawn: false,
});

/** 1.0 was dropped on 10 October, when 1.2.0 came out: its cafes have until 9 November. */
const RELEASES = [
  published("1.2.0", "2026-10-10"),
  published("1.1.0", "2026-08-01"),
  published("1.0.1", "2026-06-20"),
  published("1.0.0", "2026-06-01"),
];

const data = {
  releases: { list: async () => RELEASES },
} as unknown as DataBundle;

const cafe = (release: Partial<Cafe["release"]> = {}): Cafe => ({
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
    pinned: "1.0",
    current: "1.0.1",
    previous: null,
    ...release,
  },
  status: "live",
  createdAt: 0,
  updatedAt: 0,
});

const show = (c: Cafe, now: number) =>
  render(<UpdatesPanel data={data} cafe={c} deployments={[]} now={now} />);

const NOTICE = /no longer supported/;

describe("a cafe that stays on a line that is out of the window", () => {
  it("is told so, with the date to upgrade by and how many days are left", async () => {
    show(cafe(), at("2026-10-24T09:00:00Z"));
    const notice = await screen.findByRole("region", {
      name: "1.0 is no longer supported",
    });
    expect(notice).toHaveTextContent(
      "CafeMenu supports the latest two versions (1.2 and 1.1)",
    );
    expect(notice).toHaveTextContent(
      "Please upgrade by Nov 9, 2026 (17 days left)",
    );
    expect(notice).toHaveTextContent("After that day CafeMenu moves your cafe");
    expect(notice).toHaveTextContent("Upgrade to 1.2.0 below.");
  });

  it("shows the date as the email does, in UTC, whatever the viewer's time zone", async () => {
    // 23:00 on the 8th UTC is already the 9th in India, and still the 8th in
    // Los Angeles: the deadline day is the 9th everywhere.
    show(cafe(), at("2026-11-08T23:00:00Z"));
    const notice = await screen.findByRole("region", {
      name: "1.0 is no longer supported",
    });
    expect(notice).toHaveTextContent("Nov 9, 2026 (2 days left)");
  });

  it("says one day, not 1 days, on the last day", async () => {
    show(cafe(), at("2026-11-09T12:00:00Z"));
    expect(
      await screen.findByText(/\(1 day left\)/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("says the date has passed, and that the move comes with the next update", async () => {
    show(cafe(), at("2026-11-20T09:00:00Z"));
    const notice = await screen.findByRole("region", {
      name: "1.0 is no longer supported",
    });
    expect(notice).toHaveTextContent(
      "The date to upgrade by, Nov 9, 2026, has passed",
    );
    expect(notice).toHaveTextContent("in its next update");
  });

  it("suggests switching to updates when there is nothing newer to upgrade to", async () => {
    show(cafe({ current: "1.2.0" }), at("2026-10-24T09:00:00Z"));
    const notice = await screen.findByRole("region", {
      name: "1.0 is no longer supported",
    });
    expect(notice).toHaveTextContent("Switch to following the stable updates");
  });
});

describe("a cafe that doesn't need telling", () => {
  it("gets no notice on a supported line", async () => {
    show(cafe({ pinned: "1.1", current: "1.1.0" }), at("2026-10-24T09:00:00Z"));
    await screen.findByText(/CafeMenu supports the latest two versions/);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("gets none when it follows the stable updates", async () => {
    show(cafe({ pinned: null }), at("2026-10-24T09:00:00Z"));
    await screen.findByText(/CafeMenu supports the latest two versions/);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});

describe("the policy", () => {
  it("is always on the page: which versions, how much notice, and where to read more", async () => {
    show(cafe({ pinned: null }), at("2026-10-24T09:00:00Z"));
    const policy = await screen.findByText(
      /CafeMenu supports the latest two versions, now 1\.2 and 1\.1\./,
    );
    expect(policy).toHaveTextContent("at least 30 days ahead");
    expect(policy).toHaveTextContent("moves your cafe to a supported version");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "https://github.com/shreyashp47/cafemenu/blob/main/docs/releases.md#the-support-window",
    );
  });
});

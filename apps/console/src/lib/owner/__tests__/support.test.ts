import { describe, expect, it } from "vitest";
import type { CafeRelease, Release } from "../../platform/model";
import { supportView, supportedLines } from "../support";

const at = (iso: string) => Date.parse(iso);

const published = (
  version: string,
  date: string,
  over: Partial<Release> = {},
): Release => ({
  version,
  channel: "stable",
  notes: "",
  publishedAt: at(date),
  schemaVersion: 2,
  withdrawn: false,
  ...over,
});

/** 1.3 was dropped on 10 October, when 1.5.0 came out: its cafes have until 9 November. */
const RELEASES = [
  published("1.3.0", "2026-06-01"),
  published("1.3.1", "2026-06-20"),
  published("1.4.0", "2026-08-01"),
  published("1.5.0", "2026-10-10"),
  published("1.6.0-beta.1", "2026-10-20", { channel: "beta" }),
];

const release = (over: Partial<CafeRelease> = {}): CafeRelease => ({
  channel: "stable",
  pinned: "1.3",
  current: "1.3.1",
  previous: null,
  ...over,
});

const NOW = at("2026-10-24T09:00:00Z");

describe("the notice for a cafe on a line that is no longer supported", () => {
  it("says which line, the date, the days left and what Upgrade would do", () => {
    expect(supportView(release(), RELEASES, NOW)).toEqual({
      line: "1.3",
      upgradeBy: at("2026-11-09"),
      daysLeft: 17,
      due: false,
      supported: ["1.5", "1.4"],
      target: "1.5.0",
    });
  });

  it("is overdue after the date", () => {
    expect(
      supportView(release(), RELEASES, at("2026-11-10T00:00:00Z")),
    ).toMatchObject({
      due: true,
      daysLeft: 0,
    });
  });

  it("offers a beta cafe the newest release it follows", () => {
    expect(
      supportView(release({ channel: "beta" }), RELEASES, NOW)?.target,
    ).toBe("1.6.0-beta.1");
  });

  it("has no target when there is nothing newer to upgrade to", () => {
    expect(
      supportView(release({ current: "1.5.0" }), RELEASES, NOW)?.target,
    ).toBeNull();
  });

  it("has no date when the releases carry none", () => {
    const undated = [
      published("1.3.0", "2026-06-01"),
      { ...published("1.4.0", "2026-08-01"), publishedAt: Number.NaN },
      published("1.5.0", "2026-10-10"),
    ];
    expect(supportView(release(), undated, NOW)).toMatchObject({
      upgradeBy: null,
      daysLeft: null,
      due: false,
    });
  });
});

describe("no notice", () => {
  it("for a cafe on a supported line", () => {
    expect(supportView(release({ pinned: "1.4" }), RELEASES, NOW)).toBeNull();
    expect(supportView(release({ pinned: "1.5" }), RELEASES, NOW)).toBeNull();
  });

  it("for a cafe that follows a channel", () => {
    expect(supportView(release({ pinned: null }), RELEASES, NOW)).toBeNull();
  });

  it("when no releases are known", () => {
    expect(supportView(release(), [], NOW)).toBeNull();
  });

  it("when the line's releases were withdrawn but it is still the newest", () => {
    const withdrawn = [
      published("1.3.0", "2026-06-01", { withdrawn: true }),
      published("1.4.0", "2026-08-01"),
    ];
    expect(supportView(release(), withdrawn, NOW)).toBeNull();
  });
});

describe("the lines supported now", () => {
  it("are the latest two stable ones", () => {
    expect(supportedLines(RELEASES)).toEqual(["1.5", "1.4"]);
    expect(supportedLines([])).toEqual([]);
  });
});

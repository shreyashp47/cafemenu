import { describe, expect, it } from "vitest";
import type { CafeRelease, Deployment, Release } from "../../platform/model";
import {
  activeDeployment,
  availableReleases,
  choiceFor,
  choiceOf,
  followsChannel,
  lastFinished,
  pinLineOf,
  releaseOf,
  requestState,
  rollbackTarget,
  sameChoice,
  updateModeOf,
  updateOptions,
  upgradeOffer,
} from "../updates";

const release = (over: Partial<CafeRelease> = {}): CafeRelease => ({
  channel: "stable",
  pinned: null,
  current: "1.1.0",
  previous: "1.0.0",
  ...over,
});

const published = (
  version: string,
  channel: Release["channel"] = "stable",
  over: Partial<Release> = {},
): Release => ({
  version,
  channel,
  notes: "",
  publishedAt: Date.parse("2026-10-01T00:00:00Z"),
  schemaVersion: 2,
  withdrawn: false,
  ...over,
});

const RELEASES = [
  published("1.0.0"),
  published("1.1.0"),
  published("1.1.1"),
  published("1.2.0-beta.1", "beta"),
  published("1.2.0", "stable"),
];

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: "d1",
  cafeId: "c1",
  ownerUid: "u1",
  kind: "deploy",
  version: "1.1.1",
  fromVersion: "1.1.0",
  status: "succeeded",
  trigger: "owner",
  steps: [],
  error: null,
  createdAt: 1,
  finishedAt: 2,
  ...over,
});

describe("how a cafe follows releases", () => {
  it("is stable, beta or staying on a line", () => {
    expect(updateModeOf(release())).toBe("stable");
    expect(updateModeOf(release({ channel: "beta" }))).toBe("beta");
    expect(updateModeOf(release({ pinned: "1.1" }))).toBe("pinned");
    // A pin wins over the channel it keeps.
    expect(updateModeOf(release({ channel: "beta", pinned: "1.1" }))).toBe(
      "pinned",
    );
  });

  it("stays on the line already chosen, else the one it runs", () => {
    expect(pinLineOf(release())).toBe("1.1");
    expect(pinLineOf(release({ pinned: "1.0" }))).toBe("1.0");
    expect(pinLineOf(release({ current: null }))).toBeNull();
  });

  it("offers all three, and not 'stay on' before a first deploy", () => {
    expect(updateOptions(release()).map((o) => o.mode)).toEqual([
      "stable",
      "beta",
      "pinned",
    ]);
    expect(updateOptions(release())[2]).toEqual({
      mode: "pinned",
      line: "1.1",
      disabled: false,
    });
    expect(updateOptions(release({ current: null }))[2]).toMatchObject({
      line: null,
      disabled: true,
    });
  });

  it("saves the choice a mode means, keeping the channel when staying", () => {
    expect(choiceFor(release({ pinned: "1.0" }), "stable")).toEqual({
      channel: "stable",
      pinned: null,
    });
    expect(choiceFor(release(), "beta")).toEqual({
      channel: "beta",
      pinned: null,
    });
    expect(choiceFor(release({ channel: "beta" }), "pinned")).toEqual({
      channel: "beta",
      pinned: "1.1",
    });
  });

  it("compares choices", () => {
    expect(
      sameChoice(choiceOf(release()), choiceFor(release(), "stable")),
    ).toBe(true);
    expect(sameChoice(choiceOf(release()), choiceFor(release(), "beta"))).toBe(
      false,
    );
  });
});

describe("what is available", () => {
  it("gives stable cafes stable releases, and beta cafes all of them", () => {
    expect(followsChannel("stable", { channel: "beta" })).toBe(false);
    expect(followsChannel("stable", { channel: "stable" })).toBe(true);
    expect(followsChannel("beta", { channel: "beta" })).toBe(true);
    expect(followsChannel("beta", { channel: "stable" })).toBe(true);
  });

  it("lists newest first, without withdrawn releases", () => {
    const withdrawn = [
      ...RELEASES,
      published("1.1.2", "stable", { withdrawn: true }),
    ];
    expect(
      availableReleases(release(), withdrawn).map((r) => r.version),
    ).toEqual(["1.2.0", "1.1.1", "1.1.0", "1.0.0"]);
    expect(
      availableReleases(release({ channel: "beta" }), withdrawn).map(
        (r) => r.version,
      ),
    ).toEqual(["1.2.0", "1.2.0-beta.1", "1.1.1", "1.1.0", "1.0.0"]);
  });
});

describe("Upgrade", () => {
  it("offers the newest stable release newer than the one running", () => {
    expect(upgradeOffer(release(), RELEASES)).toEqual({
      release: RELEASES[4],
      movesLine: false,
    });
  });

  it("offers a beta to a beta cafe, and not to a stable one", () => {
    const only = [published("1.1.0"), published("1.2.0-beta.1", "beta")];
    expect(upgradeOffer(release(), only)).toBeNull();
    expect(
      upgradeOffer(release({ channel: "beta" }), only)?.release.version,
    ).toBe("1.2.0-beta.1");
  });

  it("offers nothing when up to date, or before a first deploy", () => {
    expect(upgradeOffer(release({ current: "1.2.0" }), RELEASES)).toBeNull();
    expect(upgradeOffer(release({ current: null }), RELEASES)).toBeNull();
    // A beta of the next version is older than its release.
    expect(
      upgradeOffer(release({ channel: "beta", current: "1.2.0" }), RELEASES),
    ).toBeNull();
  });

  it("offers the newer patch of the line a cafe stays on, first", () => {
    expect(upgradeOffer(release({ pinned: "1.1" }), RELEASES)).toEqual({
      release: RELEASES[2],
      movesLine: false,
    });
  });

  it("offers a newer line to a cafe at the end of its own, saying it moves", () => {
    expect(
      upgradeOffer(release({ pinned: "1.1", current: "1.1.1" }), RELEASES),
    ).toEqual({ release: RELEASES[4], movesLine: true });
  });

  it("never offers a withdrawn release", () => {
    const list = [
      published("1.1.0"),
      published("1.1.1", "stable", { withdrawn: true }),
    ];
    expect(upgradeOffer(release(), list)).toBeNull();
  });
});

describe("Roll back", () => {
  it("goes to the previous version, when there is one", () => {
    expect(rollbackTarget(release())).toBe("1.0.0");
    expect(rollbackTarget(release({ previous: null }))).toBeNull();
    expect(rollbackTarget(release({ previous: "1.1.0" }))).toBeNull();
  });

  it("finds a release's notes by version", () => {
    expect(releaseOf("1.1.1", RELEASES)).toBe(RELEASES[2]);
    expect(releaseOf("9.9.9", RELEASES)).toBeNull();
    expect(releaseOf(null, RELEASES)).toBeNull();
  });
});

describe("whether a request may be made", () => {
  it("is ready only for a live cafe with nothing running", () => {
    expect(requestState({ status: "live" }, [])).toBe("ready");
    expect(requestState({ status: "live" }, [deployment()])).toBe("ready");
    expect(
      requestState({ status: "live" }, [deployment({ status: "queued" })]),
    ).toBe("busy");
    expect(
      requestState({ status: "live" }, [
        deployment({ status: "succeeded" }),
        deployment({ id: "d0", status: "running" }),
      ]),
    ).toBe("busy");
    for (const status of [
      "draft",
      "provisioning",
      "failed",
      "disconnected",
      "suspended",
    ] as const) {
      expect(requestState({ status }, [])).toBe("not-live");
    }
  });

  it("finds the running deployment and the last finished one", () => {
    const list = [
      deployment({ id: "a", status: "running" }),
      deployment({ id: "b", status: "failed" }),
      deployment({ id: "c" }),
    ];
    expect(activeDeployment(list)?.id).toBe("a");
    expect(lastFinished(list)?.id).toBe("b");
    expect(activeDeployment([])).toBeNull();
    expect(lastFinished([deployment({ status: "queued" })])).toBeNull();
  });
});

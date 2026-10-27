/**
 * The platform admin in demo mode (#30): sees every cafe and deployment but
 * writes none of them, publishes releases and rollouts only through the
 * backend's requests, and has no way to be an owner. Mirrors the admin cases
 * in scripts/rules-test.mjs.
 */

import { newCafeSettings } from "@cafemenu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_ADMIN } from "../../config";
import type { Cafe, Deployment } from "../../platform/model";
import { demoBundle, demoVerifyEmail } from "../demo";
import { isSampleId } from "../demo-sample";
import { load, resetDemo } from "../demo-store";

const { auth, cafes, deployments, admin } = demoBundle;

const signInAdmin = () => auth.signIn(DEMO_ADMIN.email, DEMO_ADMIN.password);

async function ownerWithCafe() {
  await auth.signUp("owner@lantern.test", "correct-horse");
  demoVerifyEmail();
  return cafes.create({
    site: "lantern-cafe",
    region: "asia-south1",
    settings: newCafeSettings({ name: "Lantern Café" }),
  });
}

const latest = <T>(
  subscribe: (l: (v: T) => void, e: (err: Error) => void) => () => void,
) => {
  const seen: { value?: T; error?: Error } = {};
  const stop = subscribe(
    (v) => (seen.value = v),
    (e) => (seen.error = e),
  );
  return { seen, stop };
};

const CODE = { code: "permission-denied" };

beforeEach(() => resetDemo());

describe("the demo admin's account", () => {
  it("signs in with its own address and password, as an admin", async () => {
    await signInAdmin();
    const user = latest<{ isAdmin: boolean; emailVerified: boolean } | null>(
      (l) => auth.subscribe(l),
    );
    expect(user.seen.value).toMatchObject({
      isAdmin: true,
      emailVerified: true,
    });
    user.stop();
  });

  it("is not made by signing up, and not by a wrong password", async () => {
    await expect(
      auth.signUp(DEMO_ADMIN.email, "whatever-password"),
    ).rejects.toMatchObject({ code: "auth/email-already-in-use" });
    await expect(auth.signIn(DEMO_ADMIN.email, "wrong")).rejects.toMatchObject({
      code: "auth/invalid-credential",
    });
  });

  it("is never an owner's account", async () => {
    await ownerWithCafe();
    const user = latest<{ isAdmin: boolean } | null>((l) => auth.subscribe(l));
    expect(user.seen.value?.isAdmin).toBe(false);
    user.stop();
  });
});

describe("what the admin reads", () => {
  it("is every cafe, the sample ones and the owners', and every deployment", async () => {
    const mine = await ownerWithCafe();
    await signInAdmin();
    const all = latest<Cafe[]>((l, e) => cafes.subscribeAll(l, e));
    expect(all.seen.value?.map((c) => c.id)).toContain(mine.id);
    expect(
      all.seen.value?.filter((c) => isSampleId(c.id)).length,
    ).toBeGreaterThan(5);
    all.stop();

    const recent = latest<Deployment[]>((l, e) =>
      deployments.subscribeRecent(5, l, e),
    );
    expect(recent.seen.value).toHaveLength(5);
    // Newest first.
    const times = recent.seen.value!.map((d) => d.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    recent.stop();
  });

  it("is the same sample data the second time, not a second copy", async () => {
    await signInAdmin();
    const before = load().cafes.length;
    await auth.signOut();
    await signInAdmin();
    expect(load().cafes.length).toBe(before);
  });

  it("is refused to an owner, who sees only their own", async () => {
    const mine = await ownerWithCafe();
    const all = latest<Cafe[]>((l, e) => cafes.subscribeAll(l, e));
    expect(all.seen.error).toMatchObject(CODE);
    all.stop();
    const recent = latest<Deployment[]>((l, e) =>
      deployments.subscribeRecent(5, l, e),
    );
    expect(recent.seen.error).toMatchObject(CODE);
    recent.stop();
    const own = latest<Cafe[]>((l, e) =>
      cafes.subscribeMine(mine.ownerUid, l, e),
    );
    expect(own.seen.value?.map((c) => c.id)).toEqual([mine.id]);
    own.stop();
  });

  it("is refused to a signed-out visitor", async () => {
    const all = latest<Cafe[]>((l, e) => cafes.subscribeAll(l, e));
    expect(all.seen.error).toMatchObject(CODE);
    all.stop();
  });
});

describe("what the admin may not do", () => {
  it("write a cafe", async () => {
    await signInAdmin();
    const sample = load().cafes.find((c) => isSampleId(c.id))!;
    await expect(
      cafes.updateSettings(sample.id, newCafeSettings({ name: "Mine now" })),
    ).rejects.toMatchObject(CODE);
    await expect(
      cafes.chooseRelease(sample.id, { channel: "beta", pinned: null }),
    ).rejects.toMatchObject(CODE);
  });

  it("act as an owner, or reach one's account", () => {
    // The only things the admin can ask for.
    expect(Object.keys(admin).sort()).toEqual([
      "publishRelease",
      "rollout",
      "subscribeRollouts",
    ]);
    expect(Object.keys(auth).sort()).toEqual([
      "refresh",
      "sendVerificationEmail",
      "signIn",
      "signOut",
      "signUp",
      "subscribe",
    ]);
  });
});

describe("publishing a release", () => {
  const input = {
    version: "1.2.0",
    channel: "beta" as const,
    notes: "Orders show who asked.",
    schemaVersion: 3,
  };

  it("adds the record", async () => {
    await signInAdmin();
    await admin.publishRelease(input);
    const list = await demoBundle.releases.list();
    expect(list[0]).toMatchObject({
      version: "1.2.0",
      channel: "beta",
      notes: "Orders show who asked.",
      schemaVersion: 3,
      withdrawn: false,
    });
  });

  it("not twice, not wrongly, not by an owner", async () => {
    await signInAdmin();
    await admin.publishRelease(input);
    await expect(admin.publishRelease(input)).rejects.toMatchObject({
      code: "already-exists",
    });
    await expect(
      admin.publishRelease({ ...input, version: "1.3.0", notes: "" }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await auth.signOut();
    await ownerWithCafe();
    await expect(
      admin.publishRelease({ ...input, version: "1.4.0" }),
    ).rejects.toMatchObject(CODE);
  });
});

describe("rollouts, a stub", () => {
  it("start, pause, resume, and cannot touch a finished one", async () => {
    await signInAdmin();
    const rollouts = latest<Record<string, string>>((l, e) =>
      admin.subscribeRollouts(l, e),
    );
    // The sample data has two.
    expect(rollouts.seen.value).toEqual({
      "1.1.1": "completed",
      "1.2.0-beta.1": "running",
    });
    await admin.rollout("1.2.0-beta.1", "pause");
    expect(rollouts.seen.value?.["1.2.0-beta.1"]).toBe("paused");
    await admin.rollout("1.2.0-beta.1", "start");
    expect(rollouts.seen.value?.["1.2.0-beta.1"]).toBe("running");
    await admin.rollout("1.1.0", "start");
    expect(rollouts.seen.value?.["1.1.0"]).toBe("running");

    await expect(admin.rollout("1.1.1", "start")).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await expect(admin.rollout("1.0.0", "pause")).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await expect(admin.rollout("9.9.9", "start")).rejects.toMatchObject({
      code: "not-found",
    });
    rollouts.stop();
  });

  it("are the admin's alone", async () => {
    await ownerWithCafe();
    await expect(admin.rollout("1.1.0", "start")).rejects.toMatchObject(CODE);
    const rollouts = latest<Record<string, string>>((l, e) =>
      admin.subscribeRollouts(l, e),
    );
    expect(rollouts.seen.error).toMatchObject(CODE);
    rollouts.stop();
  });
});

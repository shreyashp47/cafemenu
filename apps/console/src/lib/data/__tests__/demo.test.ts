/**
 * Demo mode must refuse what firestore.rules refuses, with the same codes, or
 * a page built against it will break on the real thing. These mirror the
 * cases in scripts/rules-test.mjs.
 */

import { newCafeSettings, type CafeSettings } from "@cafemenu/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cafe, PlatformUser } from "../../platform/model";
import { CafeInputError } from "../../platform/validate";
import { demoBundle, demoVerifyEmail } from "../demo";
import {
  DEMO_STORAGE_KEY,
  load,
  mutate,
  parseState,
  passwordHash,
  resetDemo,
  seedState,
} from "../demo-store";

const { auth, cafes, releases, deployments } = demoBundle;

const cafeSettings = (fields: Partial<CafeSettings> = {}) =>
  newCafeSettings({ name: "Alice's", ...fields });

/** The latest value a subscription has delivered. */
function watch<T>(
  subscribe: (l: (v: T) => void, e: (err: Error) => void) => () => void,
) {
  const seen: { value?: T; error?: Error } = {};
  const stop = subscribe(
    (value) => {
      seen.value = value;
    },
    (error) => {
      seen.error = error;
    },
  );
  return { seen, stop };
}

async function verifiedOwner(email: string) {
  await auth.signUp(email, "correct-horse");
  demoVerifyEmail();
}

const me = () => {
  const { seen, stop } = watch<PlatformUser | null>((l) => auth.subscribe(l));
  stop();
  return seen.value ?? null;
};

beforeEach(() => resetDemo());

describe("demo accounts", () => {
  it("signs up unverified and signed in", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    expect(me()).toMatchObject({
      email: "alice@owner.test",
      emailVerified: false,
      isAdmin: false,
    });
  });

  it("refuses a taken email, a bad email and a short password", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    await expect(
      auth.signUp("ALICE@owner.test", "another-one"),
    ).rejects.toMatchObject({ code: "auth/email-already-in-use" });
    await expect(auth.signUp("alice", "correct-horse")).rejects.toMatchObject({
      code: "auth/invalid-email",
    });
    await expect(auth.signUp("bob@owner.test", "12345")).rejects.toMatchObject({
      code: "auth/weak-password",
    });
  });

  it("signs in with the right password only", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    await auth.signOut();
    expect(me()).toBeNull();
    await expect(
      auth.signIn("alice@owner.test", "wrong-horse"),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });
    await expect(
      auth.signIn("nobody@owner.test", "correct-horse"),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });
    await auth.signIn("Alice@Owner.test", "correct-horse");
    expect(me()?.email).toBe("alice@owner.test");
  });

  it("never keeps the password itself", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    expect(localStorage.getItem(DEMO_STORAGE_KEY)).not.toContain(
      "correct-horse",
    );
    expect(passwordHash("a@b.c", "x")).not.toBe(passwordHash("a@b.c", "y"));
  });

  it("verifies through the stand-in for the email link", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    const { seen, stop } = watch<PlatformUser | null>((l) => auth.subscribe(l));
    demoVerifyEmail();
    expect(seen.value?.emailVerified).toBe(true);
    stop();
  });

  it("needs a signed-in account to resend the link", async () => {
    await expect(auth.sendVerificationEmail()).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});

describe("demo cafes, under the same rules as Firestore", () => {
  it("an unverified account cannot create a cafe", async () => {
    await auth.signUp("alice@owner.test", "correct-horse");
    await expect(
      cafes.create({ site: "alices-cafe", settings: cafeSettings() }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("a verified owner creates a draft on no release", async () => {
    await verifiedOwner("alice@owner.test");
    const cafe = await cafes.create({
      site: "alices-cafe",
      settings: cafeSettings({ name: "Alice's" }),
      release: { channel: "beta" },
    });
    expect(cafe).toMatchObject({
      ownerUid: me()?.uid,
      ownerEmail: "alice@owner.test",
      status: "draft",
      release: { channel: "beta", pinned: null, current: null, previous: null },
    });
  });

  it("a new cafe starts on the free plan", async () => {
    await verifiedOwner("alice@owner.test");
    const error = await cafes
      .create({
        site: "alices-cafe",
        settings: { ...cafeSettings(), plan: "pro" as "free" },
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CafeInputError);
  });

  it("checks the input before anything else", async () => {
    await expect(
      cafes.create({ site: "Alice's", settings: cafeSettings() }),
    ).rejects.toBeInstanceOf(CafeInputError);
  });

  it("an owner sees their own cafes live, and not another's", async () => {
    await verifiedOwner("alice@owner.test");
    const alice = me()!;
    const { seen, stop } = watch<Cafe[]>((l, e) =>
      cafes.subscribeMine(alice.uid, l, e),
    );
    expect(seen.value).toEqual([]);
    await cafes.create({ site: "alices-cafe", settings: cafeSettings() });
    expect(seen.value).toHaveLength(1);
    stop();

    await auth.signOut();
    await verifiedOwner("bob@owner.test");
    const peek = watch<Cafe[]>((l, e) => cafes.subscribeMine(alice.uid, l, e));
    expect(peek.seen.error).toMatchObject({ code: "permission-denied" });
    expect(peek.seen.value).toBeUndefined();
    peek.stop();
  });

  it("only the admin lists every cafe, and demo mode has none", () => {
    const { seen } = watch<Cafe[]>((l, e) => cafes.subscribeAll(l, e));
    expect(seen.error).toMatchObject({ code: "permission-denied" });
  });

  describe("editing", () => {
    let cafe: Cafe;
    beforeEach(async () => {
      await verifiedOwner("alice@owner.test");
      cafe = await cafes.create({
        site: "alices-cafe",
        settings: cafeSettings(),
      });
    });
    const stored = () => load().cafes.find((c) => c.id === cafe.id)!;

    it("the owner edits settings and the release choice", async () => {
      await cafes.updateSettings(
        cafe.id,
        cafeSettings({ name: "Alice's Place" }),
      );
      await cafes.chooseRelease(cafe.id, { channel: "beta", pinned: "1.1" });
      expect(stored().settings).toMatchObject({ name: "Alice's Place" });
      expect(stored().release).toEqual({
        channel: "beta",
        pinned: "1.1",
        current: null,
        previous: null,
      });
    });

    it("refuses invalid settings, naming each field", async () => {
      const error = await cafes
        .updateSettings(cafe.id, {
          ...cafeSettings(),
          name: "",
          currency: "rupees",
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CafeInputError);
      expect((error as CafeInputError).problems).toEqual(["settings-invalid"]);
      expect((error as CafeInputError).settingsProblems).toEqual([
        "name: must be text of 1 to 60 characters",
        'currency: must be an ISO 4217 code like "INR"',
      ]);
    });

    it("saves settings cleaned, as the shared check returns them", async () => {
      await cafes.updateSettings(
        cafe.id,
        cafeSettings({ name: "  Alice's   Place ", tables: [3, 1, 2] }),
      );
      expect(stored().settings).toMatchObject({
        name: "Alice's Place",
        tables: [1, 2, 3],
      });
    });

    // While "free" is the only plan, an owner cannot even name another; the
    // rules test covers moving off a plan the backend set.
    it("the owner cannot change the plan", async () => {
      await expect(
        cafes.updateSettings(cafe.id, {
          ...cafeSettings(),
          plan: "pro" as "free",
        }),
      ).rejects.toBeInstanceOf(CafeInputError);
    });

    it("a release choice never touches current or previous", async () => {
      mutate((state) => {
        const c = state.cafes.find((x) => x.id === cafe.id)!;
        c.release = { ...c.release, current: "1.1.0", previous: "1.0.0" };
      });
      await cafes.chooseRelease(cafe.id, { channel: "stable", pinned: "1.1" });
      expect(stored().release).toMatchObject({
        current: "1.1.0",
        previous: "1.0.0",
      });
    });

    it("the project can be set while a draft, and not after", async () => {
      await cafes.connectProject(cafe.id, "alices-cafe-1a2b3");
      expect(stored().projectId).toBe("alices-cafe-1a2b3");
      mutate((state) => {
        state.cafes.find((x) => x.id === cafe.id)!.status = "provisioning";
      });
      await expect(
        cafes.connectProject(cafe.id, "other-project"),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        cafes.connectProject(cafe.id, "Not A Project"),
      ).rejects.toBeInstanceOf(CafeInputError);
    });

    it("another owner cannot edit it", async () => {
      await auth.signOut();
      await verifiedOwner("bob@owner.test");
      await expect(
        cafes.updateSettings(cafe.id, cafeSettings({ name: "Bob's now" })),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        cafes.chooseRelease(cafe.id, { channel: "beta", pinned: null }),
      ).rejects.toMatchObject({ code: "permission-denied" });
    });

    it("an owner who is no longer verified cannot edit it", async () => {
      mutate((state) => {
        state.accounts[0].emailVerified = false;
      });
      await expect(
        cafes.updateSettings(cafe.id, cafeSettings({ name: "x" })),
      ).rejects.toMatchObject({ code: "permission-denied" });
    });
  });
});

describe("demo releases and deployments", () => {
  it("releases need a verified account, and come newest first", async () => {
    await expect(releases.list()).rejects.toMatchObject({
      code: "permission-denied",
    });
    await verifiedOwner("alice@owner.test");
    const list = await releases.list();
    expect(list.map((r) => r.version)).toEqual([
      "1.2.0-beta.1",
      "1.1.1",
      "1.1.0",
      "1.0.0",
    ]);
  });

  it("an owner sees their cafe's deployments, newest first", async () => {
    await verifiedOwner("alice@owner.test");
    const cafe = await cafes.create({
      site: "alices-cafe",
      settings: cafeSettings(),
    });
    const { seen, stop } = watch<{ id: string }[]>((l, e) =>
      deployments.subscribeForCafe(cafe, l, e),
    );
    expect(seen.value).toEqual([]);
    const record = (id: string, createdAt: number) => ({
      id,
      cafeId: cafe.id,
      ownerUid: cafe.ownerUid,
      kind: "provision" as const,
      version: "1.1.1",
      fromVersion: null,
      status: "running" as const,
      trigger: "owner" as const,
      steps: [],
      error: null,
      createdAt,
      finishedAt: null,
    });
    mutate((state) => {
      state.deployments.push(record("old", 1), record("new", 2));
    });
    expect(seen.value?.map((d) => d.id)).toEqual(["new", "old"]);
    stop();
  });

  it("another owner cannot watch them", async () => {
    await verifiedOwner("alice@owner.test");
    const cafe = await cafes.create({
      site: "alices-cafe",
      settings: cafeSettings(),
    });
    await auth.signOut();
    await verifiedOwner("bob@owner.test");
    const { seen } = watch((l, e) => deployments.subscribeForCafe(cafe, l, e));
    expect(seen.error).toMatchObject({ code: "permission-denied" });
  });
});

describe("the demo store", () => {
  it("survives a corrupt or foreign value in storage", () => {
    expect(parseState("{not json").releases).toHaveLength(4);
    expect(parseState('"a string"').accounts).toEqual([]);
    const state = parseState(
      JSON.stringify({
        accounts: [{ uid: "u1" }],
        session: "u1",
        cafes: [{ id: "c1", ownerUid: 3 }],
        releases: "nope",
      }),
    );
    expect(state.accounts).toEqual([]);
    expect(state.session).toBeNull();
    expect(state.cafes).toEqual([]);
    expect(state.releases).toHaveLength(4);
  });

  it("round-trips what it saves", async () => {
    await verifiedOwner("alice@owner.test");
    await cafes.create({
      site: "alices-cafe",
      settings: cafeSettings({ name: "A" }),
    });
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    expect(parseState(raw)).toEqual(load());
    expect(load().cafes).toHaveLength(1);
  });

  it("hears a change made in another tab", () => {
    const { seen, stop } = watch<PlatformUser | null>((l) => auth.subscribe(l));
    expect(seen.value).toBeNull();
    // Another tab signs up: its write lands in storage without this tab's
    // listeners being called, until the browser fires `storage`.
    const other = seedState();
    other.accounts.push({
      uid: "owner-9",
      email: "alice@owner.test",
      passwordHash: "0",
      emailVerified: false,
    });
    other.session = "owner-9";
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(other));
    expect(seen.value).toBeNull();
    window.dispatchEvent(
      new StorageEvent("storage", { key: DEMO_STORAGE_KEY }),
    );
    expect(seen.value?.email).toBe("alice@owner.test");
    stop();
  });
});

/**
 * The Firebase adapters against the Auth and Firestore emulators, so what the
 * console sends is checked against the real firestore.rules: sign-up, the
 * email link, creating and editing a cafe, releases and deployments, and the
 * refusals an owner meets. scripts/rules-test.mjs attacks the rules head-on;
 * this checks the console's own code path through them.
 *
 *   npm run emulators          # terminal 1 (Java 21+)
 *   npm run test:emulators     # terminal 2
 *
 * Wipes the emulators' data and accounts first. Refuses a non-demo project.
 */

import { newCafeSettings, type CafeSettings } from "@cafemenu/shared";
import { applyActionCode } from "firebase/auth";
import { setLogLevel } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Cafe,
  Deployment,
  PlatformUser,
  StartingMenu,
} from "../../platform/model";
import { CafeInputError, SetupInputError } from "../../platform/validate";
import {
  connectFirebase,
  type FirebaseHandles,
  type FirebaseTarget,
} from "../firebase";
import { createFirebaseBundle } from "../firestore";
import type { DataBundle, Listener, Unsubscribe } from "../types";

const PROJECT = process.env.FIRESTORE_EMULATOR_PROJECT ?? "demo-cafemenu";
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "").split(":");
const [, authPort] = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "").split(":");
const HOST = fsHost || "127.0.0.1";
const FS_PORT = Number(fsPort || 8180);
const AUTH_PORT = Number(authPort || 9199);
const FS = `http://${HOST}:${FS_PORT}`;
const AUTH = `http://${HOST}:${AUTH_PORT}`;
const ADMIN = {
  Authorization: "Bearer owner",
  "Content-Type": "application/json",
};

const target: FirebaseTarget = {
  options: {
    projectId: PROJECT,
    apiKey: "demo-key",
    authDomain: `${PROJECT}.firebaseapp.com`,
  },
  emulators: { host: HOST, authPort: AUTH_PORT, firestorePort: FS_PORT },
};

const PASSWORD = "correct-horse";

const cafeSettings = (fields: Partial<CafeSettings> = {}) =>
  newCafeSettings({ name: "Alice's", ...fields });

/** Resolves with the first value `subscribe` delivers that passes `ok`. */
function next<T>(
  subscribe: (
    listener: Listener<T>,
    onError: (e: Error) => void,
  ) => Unsubscribe,
  ok: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let stop: Unsubscribe = () => {};
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      queueMicrotask(() => stop());
      fn();
    };
    stop = subscribe(
      (value) => {
        if (ok(value)) finish(() => resolve(value));
      },
      (error) => finish(() => reject(error)),
    );
  });
}

async function seed(path: string, fields: Record<string, unknown>) {
  const res = await fetch(
    `${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    { method: "PATCH", headers: ADMIN, body: JSON.stringify({ fields }) },
  );
  if (!res.ok) throw new Error(`seed ${path}: ${await res.text()}`);
}

const str = (stringValue: string) => ({ stringValue });
const time = (iso: string) => ({ timestampValue: iso });
const release = (channel: string) => ({
  channel: str(channel),
  notes: str("Notes."),
  publishedAt: time("2026-10-01T09:00:00Z"),
  schemaVersion: { integerValue: "1" },
  withdrawn: { booleanValue: false },
});

/** The verification link the emulator would have emailed to `email`. */
async function verificationCode(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = (await res.json()) as {
    oobCodes: { email: string; requestType: string; oobCode: string }[];
  };
  const code = oobCodes
    .filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL")
    .at(-1);
  if (!code) throw new Error(`no verification email for ${email}`);
  return code.oobCode;
}

/** A signed-up and verified owner, as one browser would be. */
async function owner(name: string, email: string) {
  const handles = connectFirebase(target, name);
  const bundle = createFirebaseBundle(() => handles, "emulators");
  await bundle.auth.signUp(email, PASSWORD);
  await applyActionCode((await handles).auth, await verificationCode(email));
  await bundle.auth.refresh();
  return { handles, bundle };
}

const apps: Promise<FirebaseHandles>[] = [];

describe.runIf(PROJECT.startsWith("demo-"))("Firebase adapters", () => {
  let alice: DataBundle;
  let aliceUser: PlatformUser;
  let cafe: Cafe;

  beforeAll(async () => {
    setLogLevel("silent");
    for (const url of [
      `${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      `${AUTH}/emulator/v1/projects/${PROJECT}/accounts`,
    ]) {
      const res = await fetch(url, { method: "DELETE", headers: ADMIN });
      if (!res.ok) throw new Error(`could not wipe ${url}`);
    }
    // Lexical order would put 1.10.0 before 1.2.0.
    await seed("releases/1.2.0", release("stable"));
    await seed("releases/1.10.0", release("stable"));
    await seed("releases/1.11.0-beta.1", release("beta"));
  });

  afterAll(async () => {
    await Promise.all(apps.map(async (h) => (await h).close()));
  });

  it("signs up unverified, and the rules refuse that account a cafe", async () => {
    const handles = connectFirebase(target, "alice");
    apps.push(handles);
    alice = createFirebaseBundle(() => handles, "emulators");

    await alice.auth.signUp("alice@owner.test", PASSWORD);
    const user = await next<PlatformUser | null>(
      (l) => alice.auth.subscribe(l),
      (u) => u !== null,
    );
    expect(user).toMatchObject({
      email: "alice@owner.test",
      emailVerified: false,
      isAdmin: false,
    });

    await expect(
      alice.cafes.create({
        site: "alices-cafe",
        region: "asia-south1",
        settings: cafeSettings(),
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(alice.releases.list()).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("is verified once the link is used and the token refreshed", async () => {
    const { auth } = await apps[0];
    await applyActionCode(auth, await verificationCode("alice@owner.test"));

    const verified = next<PlatformUser | null>(
      (l) => alice.auth.subscribe(l),
      (u) => u?.emailVerified === true,
    );
    await alice.auth.refresh();
    aliceUser = (await verified)!;
    expect(aliceUser.emailVerified).toBe(true);
  });

  it("creates a draft cafe and sees it live", async () => {
    cafe = await alice.cafes.create({
      site: "alices-cafe",
      region: "asia-south1",
      settings: cafeSettings(),
    });
    expect(cafe).toMatchObject({
      ownerUid: aliceUser.uid,
      ownerEmail: "alice@owner.test",
      status: "draft",
      projectId: null,
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
      },
    });

    const mine = await next<Cafe[]>(
      (l, e) => alice.cafes.subscribeMine(aliceUser.uid, l, e),
      (cafes) => cafes.length === 1,
    );
    expect(mine[0]).toMatchObject({ id: cafe.id, site: "alices-cafe" });
  });

  it("keeps the draft's logo and starting menu", async () => {
    const png = new Uint8Array(1024);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    await alice.setup.saveLogo(cafe.id, png);
    expect(await alice.setup.getLogo(cafe.id)).toEqual(png);

    const menu: StartingMenu = {
      source: "template",
      template: "coffee-shop",
      currency: "INR",
      items: [
        {
          name: "Flat White",
          category: "Coffee",
          description: "",
          price: 18000,
          available: true,
        },
      ],
    };
    await alice.setup.saveMenu(cafe, menu);
    expect(await alice.setup.getMenu(cafe.id)).toEqual(menu);

    await alice.setup.removeLogo(cafe.id);
    expect(await alice.setup.getLogo(cafe.id)).toBeNull();
    // Checked before writing: not a PNG, and prices in the wrong currency.
    await expect(
      alice.setup.saveLogo(cafe.id, new Uint8Array(16)),
    ).rejects.toBeInstanceOf(SetupInputError);
    await expect(
      alice.setup.saveMenu(cafe, { ...menu, currency: "USD" }),
    ).rejects.toBeInstanceOf(SetupInputError);
  });

  it("refuses a bad cafe before writing anything", async () => {
    await expect(
      alice.cafes.create({
        site: "Alice's Cafe",
        region: "asia-south1",
        settings: cafeSettings(),
      }),
    ).rejects.toBeInstanceOf(CafeInputError);
    await expect(
      alice.cafes.chooseRelease(cafe.id, { channel: "stable", pinned: "1.x" }),
    ).rejects.toBeInstanceOf(CafeInputError);
  });

  it("edits settings, the release choice and the project", async () => {
    await alice.cafes.updateSettings(
      cafe.id,
      cafeSettings({
        name: "Alice's Place",
        currency: "EUR",
        locale: "de-DE",
        timeZone: "Europe/Berlin",
      }),
    );
    await alice.cafes.chooseRelease(cafe.id, {
      channel: "beta",
      pinned: "1.10",
    });
    await alice.cafes.connectProject(cafe.id, "alices-cafe-1a2b3");

    const [after] = await next<Cafe[]>(
      (l, e) => alice.cafes.subscribeMine(aliceUser.uid, l, e),
      (cafes) => cafes[0]?.projectId === "alices-cafe-1a2b3",
    );
    expect(after).toMatchObject({
      settings: {
        name: "Alice's Place",
        currency: "EUR",
        timeZone: "Europe/Berlin",
        plan: "free",
      },
      release: {
        channel: "beta",
        pinned: "1.10",
        current: null,
        previous: null,
      },
      status: "draft",
    });
  });

  it("lists releases newest version first", async () => {
    const releases = await alice.releases.list();
    expect(releases.map((r) => r.version)).toEqual([
      "1.11.0-beta.1",
      "1.10.0",
      "1.2.0",
    ]);
  });

  it("shows the cafe's deployments as the backend records them", async () => {
    // Write only once the listener has had its first (empty) answer, as on a
    // page that is already open: a write that lands while the emulator is
    // still setting the listener up is sometimes never reported to it.
    let listening!: () => void;
    const ready = new Promise<void>((resolve) => (listening = resolve));
    const seen = next<{ id: string }[]>(
      (l, e) =>
        alice.deployments.subscribeForCafe(
          cafe,
          (list) => {
            listening();
            l(list);
          },
          e,
        ),
      (list) => list.length === 1,
    );
    await ready;
    await seed("deployments/dep-1", {
      cafeId: str(cafe.id),
      ownerUid: str(cafe.ownerUid),
      kind: str("provision"),
      version: str("1.10.0"),
      fromVersion: { nullValue: null },
      status: str("running"),
      trigger: str("owner"),
      steps: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  id: str("rules"),
                  label: str("Deploy the rules"),
                  status: str("running"),
                },
              },
            },
          ],
        },
      },
      error: { nullValue: null },
      createdAt: time("2026-10-02T09:00:00Z"),
      finishedAt: { nullValue: null },
    });
    expect(await seen).toMatchObject([
      {
        id: "dep-1",
        kind: "provision",
        status: "running",
        steps: [{ id: "rules", label: "Deploy the rules", status: "running" }],
      },
    ]);
  });

  it("does not let another owner see or touch the cafe", async () => {
    const bob = await owner("bob", "bob@owner.test");
    apps.push(bob.handles);

    await expect(
      next(
        (l, e) => bob.bundle.cafes.subscribeMine(aliceUser.uid, l, e),
        () => true,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      bob.bundle.cafes.updateSettings(cafe.id, cafeSettings({ name: "Bob's" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      next(
        (l, e) => bob.bundle.deployments.subscribeForCafe(cafe, l, e),
        () => true,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses an owner's project change once setup has started", async () => {
    // As the deployer would: only the status changes.
    const res = await fetch(
      `${FS}/v1/projects/${PROJECT}/databases/(default)/documents/cafes/${cafe.id}?updateMask.fieldPaths=status`,
      {
        method: "PATCH",
        headers: ADMIN,
        body: JSON.stringify({ fields: { status: str("provisioning") } }),
      },
    );
    expect(res.ok).toBe(true);
    // Settings are still the owner's to edit…
    await alice.cafes.updateSettings(cafe.id, cafeSettings({ tagline: "Hi" }));
    // …but not the project, nor what setup has already taken.
    await expect(
      alice.cafes.connectProject(cafe.id, "someone-elses-project"),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const png = new Uint8Array(64);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(alice.setup.saveLogo(cafe.id, png)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("lets an owner replace a live cafe's logo, for the backend to deploy", async () => {
    // As the deployer would: only the status changes.
    const setStatus = (status: string) =>
      fetch(
        `${FS}/v1/projects/${PROJECT}/databases/(default)/documents/cafes/${cafe.id}?updateMask.fieldPaths=status`,
        {
          method: "PATCH",
          headers: ADMIN,
          body: JSON.stringify({ fields: { status: str(status) } }),
        },
      );
    expect((await setStatus("live")).ok).toBe(true);
    const png = new Uint8Array(64);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    await alice.setup.saveLogo(cafe.id, png);
    expect(await alice.setup.getLogo(cafe.id)).toEqual(png);
    await alice.setup.removeLogo(cafe.id);
    expect(await alice.setup.getLogo(cafe.id)).toBeNull();
    // The menu is still only for a draft.
    await expect(
      alice.setup.saveMenu(cafe, {
        source: "blank",
        template: null,
        currency: cafe.settings.currency,
        items: [],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect((await setStatus("provisioning")).ok).toBe(true);
  });

  it("gives the admin claim to the account the backend marked", async () => {
    const admin = await owner("erin", "erin@platform.test");
    apps.push(admin.handles);
    const { auth } = await admin.handles;
    const res = await fetch(
      `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
      {
        method: "POST",
        headers: ADMIN,
        body: JSON.stringify({
          localId: auth.currentUser!.uid,
          customAttributes: JSON.stringify({ admin: true }),
        }),
      },
    );
    expect(res.ok).toBe(true);

    const promoted = next<PlatformUser | null>(
      (l) => admin.bundle.auth.subscribe(l),
      (u) => u?.isAdmin === true,
    );
    await admin.bundle.auth.refresh();
    expect((await promoted)?.isAdmin).toBe(true);

    const all = await next<Cafe[]>(
      (l, e) => admin.bundle.cafes.subscribeAll(l, e),
      (cafes) => cafes.length > 0,
    );
    expect(all.map((c) => c.id)).toContain(cafe.id);

    // The admin page's other read: the latest deployments of every cafe.
    const recent = await next<Deployment[]>(
      (l, e) => admin.bundle.deployments.subscribeRecent(10, l, e),
      (list) => list.length > 0,
    );
    expect(recent.map((d) => d.cafeId)).toContain(cafe.id);
    const times = recent.map((d) => d.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // An owner's query for them all is refused, not quietly narrowed. (Dana
    // has read no deployment yet: the SDK would answer Alice's own, kept from
    // earlier, from its cache before the server refused.)
    const dana = await owner("dana", "dana@owner.test");
    apps.push(dana.handles);
    await expect(
      next(
        (l, e) => dana.bundle.deployments.subscribeRecent(10, l, e),
        () => true,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    // The real platform has no backend to ask yet.
    await expect(
      admin.bundle.admin.rollout("1.1.0", "pause"),
    ).rejects.toMatchObject({ code: "admin-pending" });
  });

  it("signs out", async () => {
    const gone = next<PlatformUser | null>(
      (l) => alice.auth.subscribe(l),
      (u) => u === null,
    );
    await alice.auth.signOut();
    expect(await gone).toBeNull();
  });
});

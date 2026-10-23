import { beforeEach, describe, expect, it } from "vitest";
import { demoBundle, demoVerifyEmail } from "../../data/demo";
import { load, resetDemo } from "../../data/demo-store";
import type { PlatformUser } from "../../platform/model";
import { toBase64 } from "../../bytes";
import { draftOf, type SignupDraft } from "../draft";
import { cafeOf, emptyForm, withCountry, withName } from "../form";
import { saveCafe, signupStage } from "../flow";

const owner = (fields: Partial<PlatformUser> = {}): PlatformUser => ({
  uid: "u1",
  email: "owner@lantern.test",
  emailVerified: true,
  isAdmin: false,
  ...fields,
});

const draft = (fields: Partial<SignupDraft> = {}): SignupDraft => ({
  ...draftOf(
    {
      ...withCountry(withName(emptyForm(), "Lantern"), "IN"),
      email: "owner@lantern.test",
      password: "correct-horse",
    },
    "owner@lantern.test",
  ),
  ...fields,
});

describe("where the owner is", () => {
  const at = (o: Partial<Parameters<typeof signupStage>[0]>) =>
    signupStage({ ready: true, user: null, draft: null, created: null, ...o });

  it("waits for the account, then shows the form to a visitor", () => {
    expect(at({ ready: false })).toBe("loading");
    expect(at({})).toBe("form");
    expect(at({ draft: draft() })).toBe("form");
  });

  it("holds an unverified owner at the email step", () => {
    expect(at({ user: owner({ emailVerified: false }), draft: draft() })).toBe(
      "verify",
    );
    expect(at({ user: owner({ emailVerified: false }) })).toBe("verify");
  });

  it("saves the cafe once verified, from their own draft only", () => {
    expect(at({ user: owner(), draft: draft() })).toBe("create");
    expect(
      at({ user: owner({ email: "OWNER@lantern.test" }), draft: draft() }),
    ).toBe("create");
    expect(
      at({ user: owner({ email: "someone@else.test" }), draft: draft() }),
    ).toBe("form");
    expect(at({ user: owner() })).toBe("form");
  });

  it("is done once saved", () => {
    const created = { id: "c1", site: "lantern", settings: {} as never };
    expect(at({ user: owner(), created })).toBe("done");
  });
});

describe("saving the cafe", () => {
  beforeEach(async () => {
    resetDemo();
    await demoBundle.auth.signUp("owner@lantern.test", "correct-horse");
  });

  it("is refused until the email is verified, and keeps nothing", async () => {
    await expect(saveCafe(demoBundle, draft(), () => {})).rejects.toMatchObject(
      {
        code: "permission-denied",
      },
    );
    expect(load().cafes).toEqual([]);
  });

  it("writes the draft cafe, its logo and its menu", async () => {
    demoVerifyEmail();
    const png = new Uint8Array(64);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const withLogo = draft();
    withLogo.form.logo = {
      png: toBase64(png),
      width: 512,
      height: 512,
      original: { width: 512, height: 512 },
    };
    let id: string | null = null;
    const cafe = await saveCafe(demoBundle, withLogo, (cafeId) => {
      id = cafeId;
    });
    expect(id).toBe(cafe.id);
    expect(load().cafes).toHaveLength(1);
    expect(load().cafes[0]).toMatchObject({
      status: "draft",
      site: "lantern",
      region: "asia-south1",
      settings: { name: "Lantern", logo: "/logo.png", currency: "INR" },
    });
    expect(await demoBundle.setup.getLogo(cafe.id)).toEqual(png);
    expect(await demoBundle.setup.getMenu(cafe.id)).toMatchObject({
      source: "template",
      template: "coffee-shop",
    });
  });

  it("after a failure, goes on from the cafe it already made", async () => {
    demoVerifyEmail();
    const first = await demoBundle.cafes.create(
      cafeOf({ ...draft().form, password: "" }).input,
    );
    const cafe = await saveCafe(demoBundle, draft({ cafeId: first.id }), () => {
      throw new Error("not again");
    });
    expect(cafe.id).toBe(first.id);
    expect(load().cafes).toHaveLength(1);
    expect(await demoBundle.setup.getMenu(first.id)).not.toBeNull();
  });
});

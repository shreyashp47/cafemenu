import { describe, expect, it } from "vitest";
import {
  DRAFT_STORAGE_KEY,
  clearDraft,
  draftOf,
  loadDraft,
  parseDraft,
  saveDraft,
} from "../draft";
import { emptyForm, withCountry, withName } from "../form";

const form = () => ({
  ...withCountry(withName(emptyForm(), "Lantern"), "IN"),
  email: "owner@lantern.test",
  password: "correct-horse",
  accent: "#1D6A51",
  menu: { kind: "import" as const },
  menuText: "Flat White,Coffee,180",
});

describe("the sign-up draft", () => {
  it("round-trips the form, never the password", () => {
    saveDraft(draftOf(form(), "owner@lantern.test"));
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).not.toContain(
      "correct-horse",
    );
    const draft = loadDraft();
    expect(draft).toEqual({
      email: "owner@lantern.test",
      cafeId: null,
      form: { ...form(), password: undefined },
    });
    expect(draft?.form).not.toHaveProperty("password");
  });

  it("keeps the cafe's id once it exists, and is cleared after", () => {
    saveDraft({ ...draftOf(form(), "owner@lantern.test"), cafeId: "cafe-1" });
    expect(loadDraft()?.cafeId).toBe("cafe-1");
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it("reads anything odd as the blank form's value, or not at all", () => {
    expect(parseDraft("{nope")).toBeNull();
    expect(parseDraft(JSON.stringify({ form: {} }))).toBeNull();
    const draft = parseDraft(
      JSON.stringify({
        email: "a@b.test",
        form: {
          name: 5,
          theme: "neon",
          menu: { kind: "template", id: "steakhouse" },
          logo: { png: 3 },
          accent: 7,
        },
      }),
    );
    expect(draft?.form).toMatchObject({
      name: "",
      theme: "cozy",
      menu: { kind: "template", id: "coffee-shop" },
      logo: null,
      accent: null,
    });
  });
});

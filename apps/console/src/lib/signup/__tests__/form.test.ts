import {
  checkAccent,
  utcOffsetsOf,
  validateCafeSettings,
} from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import { checkNewCafe } from "../../platform/validate";
import { OTHER_COUNTRY } from "../countries";
import {
  cafeOf,
  emptyForm,
  firstProblem,
  formProblems,
  settingsOf,
  tableCount,
  withCountry,
  withName,
  withSite,
  type SignupForm,
} from "../form";

/** A form an owner in India has filled in. */
const filled = (fields: Partial<SignupForm> = {}): SignupForm => ({
  ...withCountry(withName(emptyForm("Asia/Kolkata"), "Lantern Café"), "IN"),
  email: "owner@lantern.test",
  password: "correct-horse",
  ...fields,
});

describe("filling the form", () => {
  it("makes the web address from the name until the owner edits it", () => {
    let form = withName(emptyForm(), "Lantern Café");
    expect(form.site).toBe("lantern-cafe");
    form = withName(form, "Lantern Café & Bar");
    expect(form.site).toBe("lantern-cafe-and-bar");
    form = withSite(form, " Lantern ");
    expect(form).toMatchObject({ site: "lantern", siteEdited: true });
    form = withName(form, "Something else");
    expect(form.site).toBe("lantern");
    // Clearing the address hands it back to the name.
    form = withName(withSite(form, ""), "Lantern Again");
    expect(form.site).toBe("lantern-again");
  });

  it("pre-fills currency, zone, format and region from the country", () => {
    const form = withCountry(emptyForm(), "DE");
    expect(form).toMatchObject({
      country: "DE",
      currency: "EUR",
      timeZone: "Europe/Berlin",
      locale: "de-DE",
      region: "europe-west3",
    });
    // Each stays editable, and "somewhere else" keeps what is there.
    const edited = { ...form, timeZone: "Europe/Lisbon" };
    expect(withCountry(edited, OTHER_COUNTRY)).toMatchObject({
      country: OTHER_COUNTRY,
      timeZone: "Europe/Lisbon",
      currency: "EUR",
    });
  });

  it("reads the number of tables as 1 to 50", () => {
    expect(tableCount("6")).toBe(6);
    expect(tableCount(" 50 ")).toBe(50);
    for (const bad of ["0", "51", "", "6.5", "-1", "six", "1e1"]) {
      expect(tableCount(bad)).toBeNull();
    }
  });
});

describe("checking the form", () => {
  it("passes a complete form", () => {
    expect(formProblems(filled())).toEqual({});
  });

  it("names every problem at once, first in page order", () => {
    const problems = formProblems({
      ...emptyForm(),
      name: " ",
      site: "Bad Name",
      email: "owner",
      password: "short",
      tables: "60",
      accent: "#FFFF00",
      menu: { kind: "import" },
    });
    expect(problems).toEqual({
      name: "required",
      site: "characters",
      email: "invalid",
      password: "too-short",
      country: "required",
      tables: "invalid",
      accent: "contrast",
      menu: "empty",
    });
    expect(firstProblem(problems)).toBe("name");
    expect(firstProblem({ menu: "rows", tables: "invalid" })).toBe("tables");
  });

  it("checks the accent with the shared contrast guard, on the chosen theme", () => {
    const light = "#E8B872";
    expect(checkAccent("cozy", light).ok).toBe(false);
    expect(formProblems(filled({ accent: light })).accent).toBe("contrast");
    // The same caramel is the dark theme's own: it passes there.
    expect(
      formProblems(filled({ theme: "dark", accent: light })).accent,
    ).toBeUndefined();
    expect(formProblems(filled({ accent: "red" })).accent).toBe("invalid");
    expect(formProblems(filled({ accent: null })).accent).toBeUndefined();
  });

  it("checks what the owner changed after the country", () => {
    const problems = formProblems(
      filled({
        currency: "RUPEES",
        timeZone: "Asia/Atlantis",
        locale: "en_IN",
        region: "mars-north1",
      }),
    );
    expect(problems).toEqual({
      currency: "invalid",
      timeZone: "invalid",
      locale: "invalid",
      region: "invalid",
    });
  });

  it("does not ask a signed-in owner for an email and password", () => {
    expect(
      formProblems(filled({ email: "", password: "" }), {
        needsAccount: false,
      }),
    ).toEqual({});
    expect(formProblems(filled({ email: "", password: "" }))).toEqual({
      email: "required",
      password: "required",
    });
  });
});

describe("the cafe it becomes", () => {
  it("sets every setting itself, never the demo cafe's", () => {
    const settings = settingsOf(filled({ tables: "4", accent: "#1d6a51" }));
    expect(settings).toMatchObject({
      name: "Lantern Café",
      tagline: "",
      theme: "cozy",
      accent: "#1D6A51",
      logo: null,
      currency: "INR",
      locale: "en-IN",
      moneyUnit: "minor",
      timeZone: "Asia/Kolkata",
      utcOffsets: utcOffsetsOf("Asia/Kolkata"),
      tables: [1, 2, 3, 4],
      baseUrl: null,
      plan: "free",
    });
    expect(validateCafeSettings(settings).ok).toBe(true);
  });

  it("works its zone's offsets and its currency's order cap out", () => {
    const settings = settingsOf(
      filled({ currency: "USD", locale: "en-US", timeZone: "America/Chicago" }),
    );
    expect(settings.utcOffsets).toEqual({ standard: -360, daylight: -300 });
    expect(settings.maxOrderTotal).toBeGreaterThan(0);
    expect(validateCafeSettings(settings).ok).toBe(true);
  });

  it("points the logo at /logo.png when there is one", () => {
    const logo = {
      png: "iVBORw0KGgo=",
      width: 512,
      height: 512,
      original: { width: 1024, height: 1024 },
    };
    expect(settingsOf(filled({ logo })).logo).toBe("/logo.png");
  });

  it("passes the checks the repositories make, with its menu", () => {
    const { input, menu } = cafeOf(filled());
    expect(input).toMatchObject({
      site: "lantern-cafe",
      region: "asia-south1",
    });
    expect(checkNewCafe(input).ok).toBe(true);
    expect(menu).toMatchObject({
      source: "template",
      template: "coffee-shop",
      currency: "INR",
    });
  });
});

import { describe, expect, it } from "vitest";
import { errorText, fill, messages, parseRich, problemText } from "../messages";
import { FIRESTORE_LOCATIONS } from "../platform/locations";
import type { CafeProblem, SetupProblem } from "../platform/validate";

describe("parseRich", () => {
  it("leaves plain text alone", () => {
    expect(parseRich("Just words.")).toEqual([
      { kind: "text", text: "Just words." },
    ]);
  });

  it("finds bold, code and links in order", () => {
    expect(
      parseRich(
        "**You** run `npm ci`, then read [the plan](https://x.test/p).",
      ),
    ).toEqual([
      { kind: "strong", text: "You" },
      { kind: "text", text: " run " },
      { kind: "code", text: "npm ci" },
      { kind: "text", text: ", then read " },
      { kind: "link", text: "the plan", href: "https://x.test/p" },
      { kind: "text", text: "." },
    ]);
  });

  it("only links to https, localhost, this site and anchors", () => {
    expect(parseRich("[a](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[a](javascript:alert(1)" },
      { kind: "text", text: ")" },
    ]);
    expect(parseRich("[a](http://example.test)")[0].kind).toBe("text");
    for (const href of ["/signup", "#try", "http://localhost:3000/staff"]) {
      expect(parseRich(`[a](${href})`)).toEqual([
        { kind: "link", text: "a", href },
      ]);
    }
  });

  it("keeps markup characters that are not markup", () => {
    expect(parseRich("2 * 3 and a [bracket]")).toEqual([
      { kind: "text", text: "2 * 3 and a [bracket]" },
    ]);
  });
});

describe("fill", () => {
  it("puts values in their slots, and leaves unknown slots alone", () => {
    expect(fill("Use {name} for {count} items", { name: "x", count: 3 })).toBe(
      "Use x for 3 items",
    );
    expect(fill("Hello {who}", {})).toBe("Hello {who}");
  });
});

describe("the message file", () => {
  it("has words for every validation problem", () => {
    const problems: (CafeProblem | SetupProblem)[] = [
      "site-format",
      "region-unknown",
      "logo-not-png",
      "logo-too-big",
      "menu-source",
      "menu-template",
      "menu-currency",
      "menu-empty",
      "menu-too-long",
      "menu-item",
      "project-id-format",
      "settings-invalid",
      "plan-locked",
      "channel-unknown",
      "pinned-format",
    ];
    for (const p of problems) expect(problemText(p)).toMatch(/\w/);
  });

  it("names every database location the form offers", () => {
    const names: Record<string, string> = messages.locations.names;
    for (const { id, group } of FIRESTORE_LOCATIONS) {
      expect(names[id]).toMatch(/\w/);
      expect(messages.locations.groups[group]).toMatch(/\w/);
    }
  });

  it("maps an error's code to words, with a fallback", () => {
    expect(errorText({ code: "permission-denied" })).toBe(
      messages.errors["permission-denied"],
    );
    expect(errorText(new Error("boom"))).toBe(messages.errors.unknown);
    expect(errorText(null)).toBe(messages.errors.unknown);
  });

  it("never links a customer to a real cafe's site", () => {
    // House rule 1: test orders belong in demo mode, never on a live cafe.
    expect(JSON.stringify(messages)).not.toMatch(/toe-cafe\.web\.app|toi-cafe/);
  });

  it("uses only links the renderer will keep", () => {
    const links = [...JSON.stringify(messages).matchAll(/\]\(([^)]+)\)/g)];
    expect(links.length).toBeGreaterThan(0);
    for (const [, href] of links) {
      // A link that is all slot, "({url})", is filled from
      // src/lib/setup/links.ts, whose own tests keep it to https.
      if (/^\{\w+\}$/.test(href)) continue;
      // Any other slot, as in "/setup?cafe={id}", is filled with an id.
      const filled = href.replace(/\{\w+\}/g, "x");
      expect(parseRich(`[x](${filled})`)[0].kind).toBe("link");
    }
  });

  it("marks every placeholder the Phase 0 spike fills in the same way", () => {
    const spikes = JSON.stringify(messages).match(/\[\[[^\]]*\]\]/g) ?? [];
    // The role to pick, and the screenshots of Google's consoles.
    expect(spikes.length).toBeGreaterThan(0);
    for (const spike of spikes) expect(spike).toMatch(/^\[\[SPIKE #3: .+\]\]$/);
  });
});

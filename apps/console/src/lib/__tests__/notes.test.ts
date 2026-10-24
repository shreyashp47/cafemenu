import { describe, expect, it } from "vitest";
import { parseNotes } from "../notes";

describe("parseNotes", () => {
  it("reads headings, paragraphs and lists in order", () => {
    expect(
      parseNotes(
        [
          "## What's new",
          "",
          "Orders now show **who** asked.",
          "It also carries on",
          "over two lines.",
          "",
          "- Faster menu",
          "- Fixes `a bug`",
          "  that carried on",
          "",
          "### Upgrading",
          "Nothing to do.",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "heading", text: "What's new" },
      {
        kind: "paragraph",
        text: "Orders now show **who** asked. It also carries on over two lines.",
      },
      {
        kind: "list",
        items: ["Faster menu", "Fixes `a bug` that carried on"],
      },
      { kind: "heading", text: "Upgrading" },
      { kind: "paragraph", text: "Nothing to do." },
    ]);
  });

  it("takes any bullet character and Windows line ends", () => {
    expect(parseNotes("* one\r\n+ two\r\n- three")).toEqual([
      { kind: "list", items: ["one", "two", "three"] },
    ]);
  });

  it("gives nothing for empty notes", () => {
    expect(parseNotes("")).toEqual([]);
    expect(parseNotes("  \n \n")).toEqual([]);
  });

  it("keeps markup it does not understand as plain text", () => {
    expect(parseNotes("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });
});

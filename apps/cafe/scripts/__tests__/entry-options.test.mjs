/**
 * scripts/entry.mjs takes any cafe's address, a table that cafe has, and the
 * cache version it must serve. Only the reading of those is tested here; the
 * script itself drives a browser (CI runs it against the build).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TABLE,
  PRICE,
  USAGE,
  entryOptions,
} from "../lib/entry-options.mjs";
import { PLACEHOLDER, swVersionIn } from "../lib/sw-version.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("entryOptions", () => {
  it("keeps CI's behaviour with nothing given: start the dev server, table 3", () => {
    expect(entryOptions([], {})).toEqual({
      help: false,
      url: null,
      swVersion: null,
      table: DEFAULT_TABLE,
    });
    expect(DEFAULT_TABLE).toBe(3);
  });

  it("reads BASE_URL as CI gives it", () => {
    expect(entryOptions([], { BASE_URL: "http://127.0.0.1:4320" }).url).toBe(
      "http://127.0.0.1:4320",
    );
    expect(entryOptions([], { BASE_URL: "" }).url).toBeNull();
  });

  it("takes a cafe's address, table and expected version from flags", () => {
    expect(
      entryOptions(
        [
          "--url",
          "https://lantern-cafe.web.app/",
          "--table",
          "2",
          "--sw-version",
          "3f2a9c1b7d40",
        ],
        {},
      ),
    ).toEqual({
      help: false,
      url: "https://lantern-cafe.web.app",
      swVersion: "3f2a9c1b7d40",
      table: 2,
    });
  });

  it("takes them from the environment too, and a flag wins", () => {
    const env = {
      BASE_URL: "https://a.web.app",
      EXPECT_SW_VERSION: "aaaaaaaaaaaa",
      ENTRY_TABLE: "5",
    };
    expect(entryOptions([], env)).toMatchObject({
      url: "https://a.web.app",
      swVersion: "aaaaaaaaaaaa",
      table: 5,
    });
    expect(
      entryOptions(["--url", "https://b.web.app", "--table", "6"], env),
    ).toMatchObject({ url: "https://b.web.app", table: 6 });
  });

  it("says what is wrong", () => {
    const bad = (args, env, message) =>
      expect(() => entryOptions(args, env)).toThrow(message);
    bad(["--url", "toe"], {}, /Not an address/);
    bad([], { BASE_URL: "ftp://x.web.app" }, /must be http or https/);
    bad(["--table", "0"], {}, /whole number from 1 to 50/);
    bad(["--table", "51"], {}, /whole number from 1 to 50/);
    bad(["--table", "two"], {}, /whole number/);
    bad(["--sw-version", "a b"], {}, /Not a cache version/);
    bad(["--nonsense"], {}, /Unknown option/);
  });

  it("answers --help", () => {
    expect(entryOptions(["--help"], {}).help).toBe(true);
    expect(USAGE).toMatch(/--sw-version/);
  });
});

describe("PRICE", () => {
  it.each([
    "₹120.00",
    "₹ 120",
    "$4.50",
    "CA$4.50",
    "4,50 €",
    "£3.20",
    "¥500",
    "CHF 4.50",
    "Flat white  ₹140",
  ])("sees a price in %s", (text) => {
    expect(PRICE.test(text)).toBe(true);
  });

  it.each([
    "Scan the QR code on your table",
    "Table 5",
    "Ask at the counter",
    "",
  ])("sees none in %s", (text) => {
    expect(PRICE.test(text)).toBe(false);
  });
});

describe("swVersionIn", () => {
  it("reads the version out of a stamped service worker", () => {
    expect(
      swVersionIn('const PREFIX = "cafe-";\nconst VERSION = "3f2a9c";'),
    ).toBe("3f2a9c");
    expect(swVersionIn("const VERSIONS = 1;")).toBeNull();
  });

  it("reads the placeholder out of the source in public/", async () => {
    const source = await readFile(join(HERE, "../../public/sw.js"), "utf8");
    expect(swVersionIn(source)).toBe(PLACEHOLDER);
  });
});

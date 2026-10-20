import assert from "node:assert/strict";
import { test } from "node:test";

import { changelogSection } from "../lib/changelog.mjs";
import { FIXTURE } from "./helpers.mjs";

const CHANGELOG = FIXTURE["CHANGELOG.md"];

test("finds a version's section, without the file's link definitions", () => {
  assert.equal(
    changelogSection(CHANGELOG, "0.2.0-beta.1"),
    "### Added\n\n- Staff invites, for beta cafes.\n",
  );
});

test("0.2.0 does not match the 0.2.0-beta.1 heading, or the other way round", () => {
  assert.equal(
    changelogSection(CHANGELOG, "0.2.0"),
    "### Added\n\n- Staff invites.\n",
  );
  assert.equal(
    changelogSection("## [0.2.0-beta.1]\n\n- beta\n", "0.2.0"),
    null,
  );
  assert.equal(
    changelogSection("## [0.2.0]\n\n- stable\n", "0.2.0-beta.1"),
    null,
  );
});

test("a version with no section, or an empty one, has no notes", () => {
  assert.equal(changelogSection(CHANGELOG, "9.9.9"), null);
  assert.equal(
    changelogSection("## [1.0.0] - 2026-12-01\n\n## [0.9.0]\n\n- x\n", "1.0.0"),
    null,
  );
});

test("headings may skip the brackets or carry a v", () => {
  assert.equal(
    changelogSection("## v1.0.0 (2026-12-01)\n- one\n", "1.0.0"),
    "- one\n",
  );
  assert.equal(changelogSection("## 1.0.0\r\n- two\r\n", "1.0.0"), "- two\n");
});

test("a section keeps its own ### headings and stops at the next ## or #", () => {
  const markdown =
    "## [1.0.0]\n\n### Fixed\n\n- a\n\n### Added\n\n- b\n\n# Older\n\n- c\n";
  assert.equal(
    changelogSection(markdown, "1.0.0"),
    "### Fixed\n\n- a\n\n### Added\n\n- b\n",
  );
});

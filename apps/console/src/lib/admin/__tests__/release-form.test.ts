import { describe, expect, it } from "vitest";
import { errorText, messages } from "../../messages";
import type { Release } from "../../platform/model";
import {
  MAX_NOTES_LENGTH,
  emptyReleaseForm,
  firstReleaseProblem,
  latestSchema,
  releaseFormProblems,
  releaseInputOf,
  releaseInputProblems,
  schemaOf,
  type ReleaseForm,
  type ReleaseProblem,
} from "../release-form";

const published = (version: string, schemaVersion: number): Release => ({
  version,
  channel: "stable",
  notes: "",
  publishedAt: 1,
  schemaVersion,
  withdrawn: false,
});

const form = (over: Partial<ReleaseForm> = {}): ReleaseForm => ({
  version: "1.2.0",
  channel: "beta",
  notes: "Orders now show who asked.",
  schemaVersion: "3",
  ...over,
});

describe("the blank form", () => {
  it("goes to beta first, on the newest schema", () => {
    const list = [published("1.0.0", 1), published("1.1.0", 3)];
    expect(latestSchema(list)).toBe(3);
    expect(emptyReleaseForm(list)).toEqual({
      version: "",
      channel: "beta",
      notes: "",
      schemaVersion: "3",
    });
    expect(emptyReleaseForm([]).schemaVersion).toBe("1");
  });
});

describe("what is wrong with a release", () => {
  it("is nothing for a good one", () => {
    expect(releaseFormProblems(form(), ["1.1.0"])).toEqual({});
  });

  it("wants a version, not already published", () => {
    expect(releaseFormProblems(form({ version: "1.2" }), []).version).toBe(
      "version-format",
    );
    expect(releaseFormProblems(form({ version: "v1.2.0" }), []).version).toBe(
      "version-format",
    );
    expect(
      releaseFormProblems(form({ version: " 1.1.0 " }), ["1.1.0"]).version,
    ).toBe("version-taken");
    expect(
      releaseFormProblems(form({ version: "1.2.0-beta.1" }), []).version,
    ).toBeUndefined();
  });

  it("keeps a pre-release out of stable", () => {
    expect(
      releaseFormProblems(
        form({ version: "1.2.0-beta.1", channel: "stable" }),
        [],
      ).channel,
    ).toBe("prerelease-stable");
    expect(
      releaseFormProblems(form({ version: "1.2.0", channel: "stable" }), [])
        .channel,
    ).toBeUndefined();
    expect(
      releaseFormProblems(form({ channel: "nightly" as never }), []).channel,
    ).toBe("channel-unknown");
  });

  it("wants notes, of a sensible length, and a schema from 1", () => {
    expect(releaseFormProblems(form({ notes: "  " }), []).notes).toBe(
      "notes-empty",
    );
    expect(
      releaseFormProblems(form({ notes: "x".repeat(MAX_NOTES_LENGTH + 1) }), [])
        .notes,
    ).toBe("notes-long");
    for (const schemaVersion of ["", "0", "-1", "1.5", "abc"]) {
      expect(
        releaseFormProblems(form({ schemaVersion }), []).schemaVersion,
      ).toBe("schema-invalid");
    }
    expect(schemaOf(" 4 ")).toBe(4);
  });

  it("names every problem at once and the first in page order", () => {
    const problems = releaseFormProblems(
      form({ version: "x", notes: "", schemaVersion: "0" }),
      [],
    );
    expect(Object.keys(problems).sort()).toEqual([
      "notes",
      "schemaVersion",
      "version",
    ]);
    expect(firstReleaseProblem(problems)).toBe("version");
    expect(firstReleaseProblem({})).toBeNull();
  });
});

describe("the request", () => {
  it("is the form, trimmed and numbered", () => {
    expect(
      releaseInputOf(
        form({ version: " 1.2.0 ", notes: "  Hi\n", schemaVersion: " 3" }),
      ),
    ).toEqual({
      version: "1.2.0",
      channel: "beta",
      notes: "Hi",
      schemaVersion: 3,
    });
  });

  it("is checked again by whatever receives it", () => {
    expect(releaseInputProblems(releaseInputOf(form()))).toEqual([]);
    expect(
      releaseInputProblems({
        version: "1.2.0-rc.1",
        channel: "stable",
        notes: "",
        schemaVersion: 0,
      }),
    ).toEqual(["prerelease-stable", "schema-invalid", "notes-empty"]);
    expect(
      releaseInputProblems({
        version: "nope",
        channel: "nightly" as never,
        notes: "x",
        schemaVersion: 1,
      }),
    ).toEqual(["version-format", "channel-unknown"]);
  });
});

describe("the words", () => {
  it("has some for every problem, and for what the backend answers", () => {
    const codes: ReleaseProblem[] = [
      "version-format",
      "version-taken",
      "prerelease-stable",
      "channel-unknown",
      "notes-empty",
      "notes-long",
      "schema-invalid",
    ];
    for (const code of codes) {
      expect(messages.admin.releases.problems[code]).toMatch(/\w/);
    }
    for (const code of [
      "already-exists",
      "admin-pending",
      "permission-denied",
    ]) {
      expect(errorText({ code })).not.toBe(messages.errors.unknown);
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_REQUEST_KINDS,
  REQUEST_KINDS,
  isOpenRequest,
  newRequestRecord,
  requestParamsProblem,
} from "../requests.mjs";

describe("what each kind of request takes", () => {
  it("check takes exactly a project ID", () => {
    expect(requestParamsProblem("check", { projectId: "lantern-cafe" })).toBe(
      null,
    );
    expect(requestParamsProblem("check", { projectId: "Lantern" })).toBe(
      "project-id",
    );
    expect(requestParamsProblem("check", { projectId: 42 })).toBe("project-id");
    expect(requestParamsProblem("check", {})).toBe("params");
    expect(
      requestParamsProblem("check", { projectId: "lantern-cafe", extra: 1 }),
    ).toBe("params");
  });

  it("deploy takes exactly a release version", () => {
    expect(requestParamsProblem("deploy", { version: "1.4.2" })).toBe(null);
    expect(requestParamsProblem("deploy", { version: "1.5.0-beta.1" })).toBe(
      null,
    );
    expect(requestParamsProblem("deploy", { version: "v1.4.2" })).toBe(
      "version",
    );
    expect(requestParamsProblem("deploy", { version: "1.4" })).toBe("version");
    expect(requestParamsProblem("deploy", {})).toBe("params");
  });

  it("the others take nothing", () => {
    for (const kind of ["provision", "rollback", "sync-branding"]) {
      expect(requestParamsProblem(kind, {})).toBe(null);
      expect(requestParamsProblem(kind, { version: "1.0.0" })).toBe("params");
    }
  });

  it("refuses a kind it doesn't know, and params that aren't a map", () => {
    expect(requestParamsProblem("delete-everything", {})).toBe("kind");
    expect(requestParamsProblem("rollback", null)).toBe("params");
    expect(requestParamsProblem("rollback", [])).toBe("params");
  });

  it("every kind but check becomes a deployment", () => {
    expect(
      REQUEST_KINDS.filter((k) => !DEPLOYMENT_REQUEST_KINDS.includes(k)),
    ).toEqual(["check"]);
  });
});

describe("the record a person writes", () => {
  it("is queued, with only the fields the rules allow", () => {
    const record = newRequestRecord(
      {
        cafeId: "cafe1",
        kind: "deploy",
        params: { version: "1.2.0" },
        by: "u1",
      },
      1234,
    );
    expect(record).toEqual({
      cafeId: "cafe1",
      kind: "deploy",
      params: { version: "1.2.0" },
      status: "queued",
      createdAt: 1234,
      by: "u1",
    });
  });

  it("takes no params for a kind that needs none", () => {
    expect(
      newRequestRecord({ cafeId: "cafe1", kind: "rollback", by: "u1" }, 0)
        .params,
    ).toEqual({});
  });

  it("throws before anything is written when the request is wrong", () => {
    expect(() =>
      newRequestRecord({ cafeId: "a/b", kind: "rollback", by: "u1" }, 0),
    ).toThrow(/cafe/);
    expect(() =>
      newRequestRecord({ cafeId: "cafe1", kind: "rollback", by: "" }, 0),
    ).toThrow(/who asked/);
    expect(() =>
      newRequestRecord(
        { cafeId: "cafe1", kind: "deploy", params: { version: "x" }, by: "u" },
        0,
      ),
    ).toThrow(/version/);
  });

  it("is open while queued or running", () => {
    expect(isOpenRequest("queued")).toBe(true);
    expect(isOpenRequest("running")).toBe(true);
    expect(isOpenRequest("done")).toBe(false);
    expect(isOpenRequest("failed")).toBe(false);
  });
});

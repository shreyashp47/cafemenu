import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_REQUEST_KINDS,
  ADMIN_REQUEST_KINDS,
  OWNER_REQUEST_KINDS,
  REQUEST_KINDS,
  isAdminRequestKind,
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
      OWNER_REQUEST_KINDS.filter((k) => !DEPLOYMENT_REQUEST_KINDS.includes(k)),
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

describe("what the admin's requests take (#78)", () => {
  const at = new Date("2026-11-01T10:00:00Z");

  it("suspend: a reason from the policy, a note, and when", () => {
    const ok = { reason: "abuse", note: "Spam orders.", effectiveAt: null };
    expect(requestParamsProblem("suspend", ok)).toBe(null);
    expect(requestParamsProblem("suspend", { ...ok, effectiveAt: at })).toBe(
      null,
    );
    expect(requestParamsProblem("suspend", { ...ok, reason: "boredom" })).toBe(
      "reason",
    );
    expect(
      requestParamsProblem("suspend", { ...ok, reason: "migration" }),
    ).toBe("reason");
    expect(
      requestParamsProblem("suspend", { ...ok, note: "x".repeat(501) }),
    ).toBe("note");
    expect(
      requestParamsProblem("suspend", { ...ok, effectiveAt: "tomorrow" }),
    ).toBe("time");
    expect(requestParamsProblem("suspend", { reason: "abuse", note: "" })).toBe(
      "params",
    );
  });

  it("reactivate: a reason that ends a suspension", () => {
    expect(
      requestParamsProblem("reactivate", { reason: "resolved", note: "" }),
    ).toBe(null);
    expect(
      requestParamsProblem("reactivate", { reason: "abuse", note: "" }),
    ).toBe("reason");
  });

  it("delete-owner: the web address typed out", () => {
    const ok = { reason: "owner-request", note: "", confirm: "lantern-cafe" };
    expect(requestParamsProblem("delete-owner", ok)).toBe(null);
    expect(requestParamsProblem("delete-owner", { ...ok, confirm: "" })).toBe(
      "confirm",
    );
  });

  it("maintenance: a message customers read, times, and a batch for several cafes", () => {
    const ok = {
      reason: "migration",
      note: "",
      message: "Back after the update.",
      until: at,
      startsAt: null,
      endsAt: null,
      batch: null,
    };
    expect(requestParamsProblem("maintenance-on", ok)).toBe(null);
    expect(
      requestParamsProblem("maintenance-on", { ...ok, batch: "b-20261101" }),
    ).toBe(null);
    expect(
      requestParamsProblem("maintenance-on", {
        ...ok,
        message: "x".repeat(281),
      }),
    ).toBe("message");
    expect(requestParamsProblem("maintenance-on", { ...ok, startsAt: 5 })).toBe(
      "time",
    );
    expect(
      requestParamsProblem("maintenance-on", { ...ok, batch: "a/b" }),
    ).toBe("batch");
    expect(
      requestParamsProblem("maintenance-off", { note: "Done.", batch: null }),
    ).toBe(null);
  });

  it("appoint-admin and remove-admin: an email address, and no cafe", () => {
    const ok = { email: "erin@cafemenu.example", note: "" };
    expect(requestParamsProblem("appoint-admin", ok)).toBe(null);
    expect(requestParamsProblem("remove-admin", ok)).toBe(null);
    expect(
      requestParamsProblem("appoint-admin", { ...ok, email: "erin" }),
    ).toBe("email");
    expect(
      newRequestRecord(
        { cafeId: null, kind: "appoint-admin", params: ok, by: "u" },
        0,
      ).cafeId,
    ).toBe(null);
    expect(() =>
      newRequestRecord(
        { cafeId: "c1", kind: "appoint-admin", params: ok, by: "u" },
        0,
      ),
    ).toThrow(/account, not a cafe/);
    expect(() =>
      newRequestRecord({ cafeId: null, kind: "rollback", by: "u" }, 0),
    ).toThrow(/cafe it is about/);
  });

  it("are told apart from an owner's", () => {
    expect(isAdminRequestKind("suspend")).toBe(true);
    expect(isAdminRequestKind("deploy")).toBe(false);
    expect([...OWNER_REQUEST_KINDS, ...ADMIN_REQUEST_KINDS].sort()).toEqual(
      [...REQUEST_KINDS].sort(),
    );
  });
});

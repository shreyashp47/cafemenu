import { describe, expect, it, vi } from "vitest";
import {
  callableConnectionChecker,
  callableDeployRequests,
  codedFrom,
} from "../callables";
import { CodedError } from "../types";

const cafe = { id: "cafe1" };

describe("Check connection through the backend", () => {
  it("asks checkConnection about the cafe and its project, and returns the answer", async () => {
    const missing = {
      status: "missing",
      missing: [
        { permission: "a.b.c", why: "do x", neededBy: ["provision"] },
        { nonsense: true },
      ],
    };
    const call = vi
      .fn()
      .mockResolvedValueOnce({ status: "connected" })
      .mockResolvedValueOnce({ status: "no-access" })
      .mockResolvedValueOnce(missing);
    const checker = callableConnectionChecker(call);
    const input = { id: "cafe1", projectId: "lantern-cafe-1a2b" };

    expect(await checker.check(input)).toEqual({ status: "connected" });
    expect(call).toHaveBeenCalledWith("checkConnection", {
      cafeId: "cafe1",
      projectId: "lantern-cafe-1a2b",
    });
    expect(await checker.check(input)).toEqual({ status: "no-access" });
    // A row that is not one is dropped, as the wizard does with a saved one.
    expect(await checker.check(input)).toEqual({
      status: "missing",
      missing: [missing.missing[0]],
    });
  });

  it("fails with the backend's code, and refuses an answer it does not understand", async () => {
    const denied = Object.assign(new Error("This isn't your cafe."), {
      code: "functions/permission-denied",
    });
    const checker = callableConnectionChecker(
      vi
        .fn()
        .mockRejectedValueOnce(denied)
        .mockResolvedValueOnce({ status: "maybe" })
        .mockResolvedValueOnce(null),
    );
    const input = { id: "cafe1", projectId: "lantern-cafe-1a2b" };
    await expect(checker.check(input)).rejects.toMatchObject({
      code: "permission-denied",
      message: "This isn't your cafe.",
    });
    await expect(checker.check(input)).rejects.toMatchObject({
      code: "internal",
    });
    await expect(checker.check(input)).rejects.toMatchObject({
      code: "internal",
    });
  });
});

describe("Upgrade, Roll back and Save branding through the backend", () => {
  it("calls the function for each and returns where the progress shows up", async () => {
    const call = vi.fn().mockResolvedValue({ deploymentId: "dep1" });
    const deploys = callableDeployRequests(call);

    expect(await deploys.upgrade(cafe, "1.2.0")).toEqual({
      deploymentId: "dep1",
    });
    expect(await deploys.rollback(cafe)).toEqual({ deploymentId: "dep1" });
    expect(await deploys.syncBranding(cafe)).toEqual({ deploymentId: "dep1" });
    expect(call.mock.calls).toEqual([
      ["requestUpgrade", { cafeId: "cafe1", version: "1.2.0" }],
      ["requestRollback", { cafeId: "cafe1" }],
      ["requestSyncBranding", { cafeId: "cafe1" }],
    ]);
  });

  it("passes on the codes the pages have words for", async () => {
    for (const code of [
      "permission-denied",
      "failed-precondition",
      "invalid-argument",
    ]) {
      const deploys = callableDeployRequests(
        vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("because"), { code: `functions/${code}` }),
          ),
      );
      await expect(deploys.rollback(cafe)).rejects.toMatchObject({
        code,
        message: "because",
      });
    }
  });

  it("does not take an answer without a deployment for success", async () => {
    const deploys = callableDeployRequests(vi.fn().mockResolvedValue({}));
    await expect(deploys.rollback(cafe)).rejects.toMatchObject({
      code: "internal",
    });
  });
});

describe("codedFrom", () => {
  it("keeps a CodedError, strips the functions/ prefix, and leaves other errors alone", () => {
    const coded = new CodedError("unavailable");
    expect(codedFrom(coded)).toBe(coded);
    expect(codedFrom({ code: "functions/unavailable" })).toMatchObject({
      code: "unavailable",
      message: "functions/unavailable",
    });
    const plain = new TypeError("offline");
    expect(codedFrom(plain)).toBe(plain);
  });
});

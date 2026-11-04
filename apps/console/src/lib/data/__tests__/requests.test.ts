import { describe, expect, it, vi } from "vitest";
import { fakeRequests } from "@/test/requests";
import { backendModeOf } from "../../config";
import {
  requestConnectionChecker,
  requestDeployRequests,
  untilFinished,
} from "../requests";

const cafe = { id: "cafe1" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("which backend the console asks", () => {
  it("is the requests on GitHub Actions, the functions on Blaze, or none", () => {
    expect(backendModeOf("requests", "")).toBe("requests");
    expect(backendModeOf(" Requests ", undefined)).toBe("requests");
    expect(backendModeOf("functions", undefined)).toBe("functions");
    expect(backendModeOf(undefined, "1")).toBe("functions");
    expect(backendModeOf("", "true")).toBe("functions");
    expect(backendModeOf("requests", "1")).toBe("requests");
    expect(backendModeOf(undefined, undefined)).toBe("none");
    expect(backendModeOf("cron", "")).toBe("none");
  });
});

describe("Check connection as a request", () => {
  it("writes a check for the cafe's project and waits for the backend's answer, passing on its progress", async () => {
    const fake = fakeRequests();
    const onProgress = vi.fn();
    const answer = requestConnectionChecker(fake.repo).check(
      { id: "cafe1", projectId: "lantern-cafe-1a2b" },
      { onProgress },
    );
    await tick();
    const request = fake.last()!;
    expect(request).toMatchObject({
      cafeId: "cafe1",
      kind: "check",
      params: { projectId: "lantern-cafe-1a2b" },
      status: "queued",
    });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "queued" }),
    );

    fake.answer(request.id, { status: "running" });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "running" }),
    );
    fake.answer(request.id, {
      status: "done",
      result: { status: "missing", missing: [{ nonsense: true }] },
    });
    // A row that is not one is dropped, as from the callable.
    expect(await answer).toEqual({ status: "missing", missing: [] });
  });

  it("fails with the backend's code and words when it refused", async () => {
    const fake = fakeRequests();
    const answer = requestConnectionChecker(fake.repo).check({
      id: "cafe1",
      projectId: "lantern-cafe-1a2b",
    });
    await tick();
    fake.answer(fake.last()!.id, {
      status: "failed",
      errorCode: "unavailable",
      error: "Google didn't answer just now. Try again in a minute.",
    });
    await expect(answer).rejects.toMatchObject({
      code: "unavailable",
      message: "Google didn't answer just now. Try again in a minute.",
    });
  });

  it("refuses an answer it doesn't understand", async () => {
    const fake = fakeRequests();
    const answer = requestConnectionChecker(fake.repo).check({
      id: "cafe1",
      projectId: "lantern-cafe-1a2b",
    });
    await tick();
    fake.answer(fake.last()!.id, { status: "done", result: { status: "?" } });
    await expect(answer).rejects.toMatchObject({ code: "internal" });
  });

  it("stops listening once it has its answer", async () => {
    const fake = fakeRequests();
    const id = await fake.repo.create({ cafeId: "cafe1", kind: "rollback" });
    const seen = vi.fn();
    const done = untilFinished(fake.repo, id, seen);
    await tick();
    fake.answer(id, { status: "done" });
    await done;
    await tick();
    fake.answer(id, { status: "failed" });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("Upgrade, Roll back and Save branding as requests", () => {
  it("each writes its request and returns at once with its id", async () => {
    const fake = fakeRequests();
    const deploys = requestDeployRequests(fake.repo);
    expect(await deploys.upgrade(cafe, "1.2.0")).toEqual({
      requestId: "req1",
    });
    expect(await deploys.rollback(cafe)).toEqual({ requestId: "req2" });
    expect(await deploys.syncBranding(cafe)).toEqual({ requestId: "req3" });
    expect([...fake.requests.values()].map((r) => [r.kind, r.params])).toEqual([
      ["deploy", { version: "1.2.0" }],
      ["rollback", {}],
      ["sync-branding", {}],
    ]);
  });

  it("fails as the repository fails, when the rules refuse it", async () => {
    const fake = fakeRequests();
    fake.repo.create = () =>
      Promise.reject(
        Object.assign(new Error("no"), { code: "permission-denied" }),
      );
    await expect(
      requestDeployRequests(fake.repo).rollback(cafe),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

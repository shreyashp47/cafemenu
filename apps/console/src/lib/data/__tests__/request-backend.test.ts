import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendRequest } from "../../platform/model";
import {
  requestConnectionChecker,
  requestDeployRequests,
  type RequestTransport,
} from "../request-backend";
import { CodedError, type Listener } from "../types";

const request = (fields: Partial<BackendRequest> = {}): BackendRequest => ({
  id: "req1",
  cafeId: "cafe1",
  ownerUid: "owner1",
  kind: "check",
  status: "queued",
  steps: [],
  detail: null,
  result: null,
  error: null,
  errorCode: null,
  deploymentId: null,
  createdAt: 1,
  finishedAt: null,
  ...fields,
});

/** A transport whose request the test answers by hand, as the worker would. */
function fakeTransport() {
  let listener: Listener<BackendRequest | null> = () => {};
  let fail: (error: Error) => void = () => {};
  const stopped = vi.fn();
  const transport: RequestTransport = {
    create: vi.fn().mockResolvedValue("req1"),
    watch: vi.fn((_id, onRequest, onError) => {
      listener = onRequest;
      fail = onError;
      return stopped;
    }),
  };
  return {
    transport,
    stopped,
    answer: (r: BackendRequest | null) => listener(r),
    breakWatch: (error: Error) => fail(error),
  };
}

const cafe = { id: "cafe1", projectId: "lantern-cafe-1a2b" };

afterEach(() => vi.useRealTimers());

describe("Check connection as a request", () => {
  it("writes a check for the cafe's project and waits for the worker's answer", async () => {
    const t = fakeTransport();
    const progress: string[] = [];
    const checking = requestConnectionChecker(t.transport).check(cafe, {
      onProgress: (p) => progress.push(`${p.status}:${p.steps.length}`),
    });
    await vi.waitFor(() => expect(t.transport.watch).toHaveBeenCalled());
    expect(t.transport.create).toHaveBeenCalledWith("cafe1", "check", {
      projectId: "lantern-cafe-1a2b",
    });

    t.answer(request());
    t.answer(
      request({
        status: "running",
        steps: [{ id: "check", label: "Check", status: "running" }],
      }),
    );
    t.answer(
      request({
        status: "done",
        result: {
          status: "missing",
          missing: [
            { permission: "a.b.c", why: "do x", neededBy: ["provision"] },
            { nonsense: true },
          ],
        },
      }),
    );
    expect(await checking).toEqual({
      status: "missing",
      missing: [{ permission: "a.b.c", why: "do x", neededBy: ["provision"] }],
    });
    expect(progress).toEqual(["queued:0", "running:1", "done:0"]);
    expect(t.stopped).toHaveBeenCalledOnce();
  });

  it("passes on a connected and a no-access answer", async () => {
    for (const status of ["connected", "no-access"] as const) {
      const t = fakeTransport();
      const checking = requestConnectionChecker(t.transport).check(cafe);
      await vi.waitFor(() => expect(t.transport.watch).toHaveBeenCalled());
      t.answer(request({ status: "done", result: { status } }));
      expect(await checking).toEqual({ status });
    }
  });

  it("fails with the worker's code and words when it refused or could not", async () => {
    const t = fakeTransport();
    const checking = requestConnectionChecker(t.transport).check(cafe);
    await vi.waitFor(() => expect(t.transport.watch).toHaveBeenCalled());
    t.answer(
      request({
        status: "failed",
        error: "Google didn't answer just now.",
        errorCode: "unavailable",
      }),
    );
    await expect(checking).rejects.toMatchObject({
      code: "unavailable",
      message: "Google didn't answer just now.",
    });
    expect(t.stopped).toHaveBeenCalledOnce();
  });

  it("refuses an answer it does not understand", async () => {
    const t = fakeTransport();
    const checking = requestConnectionChecker(t.transport).check(cafe);
    await vi.waitFor(() => expect(t.transport.watch).toHaveBeenCalled());
    t.answer(request({ status: "done", result: { status: "maybe" } }));
    await expect(checking).rejects.toMatchObject({ code: "internal" });
  });

  it("fails with the code Firestore gave when the request can't be written or watched", async () => {
    const denied = Object.assign(new Error("Missing permissions"), {
      code: "permission-denied",
    });
    const t = fakeTransport();
    vi.mocked(t.transport.create).mockRejectedValueOnce(denied);
    await expect(
      requestConnectionChecker(t.transport).check(cafe),
    ).rejects.toMatchObject({ code: "permission-denied" });

    const t2 = fakeTransport();
    const checking = requestConnectionChecker(t2.transport).check(cafe);
    await vi.waitFor(() => expect(t2.transport.watch).toHaveBeenCalled());
    t2.breakWatch(denied);
    await expect(checking).rejects.toMatchObject({ code: "permission-denied" });
    expect(t2.stopped).toHaveBeenCalledOnce();
  });

  it("gives up waiting after a while, because the schedule may be paused", async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const checking = requestConnectionChecker(t.transport, {
      waitMs: 60_000,
    }).check(cafe);
    const rejected = expect(checking).rejects.toBeInstanceOf(CodedError);
    await vi.advanceTimersByTimeAsync(59_000);
    t.answer(request());
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    await expect(checking).rejects.toMatchObject({ code: "deadline-exceeded" });
    expect(t.stopped).toHaveBeenCalledOnce();
    // A late answer changes nothing.
    t.answer(request({ status: "done", result: { status: "connected" } }));
  });
});

describe("Upgrade, Roll back and Save branding as requests", () => {
  it("each writes its request and returns at once, saying where to look", async () => {
    const t = fakeTransport();
    const deploys = requestDeployRequests(t.transport);

    expect(await deploys.upgrade({ id: "cafe1" }, "1.2.0")).toEqual({
      requestId: "req1",
    });
    expect(t.transport.create).toHaveBeenLastCalledWith("cafe1", "deploy", {
      version: "1.2.0",
    });
    await deploys.rollback({ id: "cafe1" });
    expect(t.transport.create).toHaveBeenLastCalledWith(
      "cafe1",
      "rollback",
      {},
    );
    await deploys.syncBranding({ id: "cafe1" });
    expect(t.transport.create).toHaveBeenLastCalledWith(
      "cafe1",
      "sync-branding",
      {},
    );
    expect(t.transport.watch).not.toHaveBeenCalled();
  });

  it("fails with the rules' code when they refuse", async () => {
    const t = fakeTransport();
    vi.mocked(t.transport.create).mockRejectedValueOnce(
      Object.assign(new Error("Missing permissions"), {
        code: "permission-denied",
      }),
    );
    await expect(
      requestDeployRequests(t.transport).rollback({ id: "cafe1" }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

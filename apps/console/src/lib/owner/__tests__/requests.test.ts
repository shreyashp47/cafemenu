import { describe, expect, it } from "vitest";
import type { BackendRequest, Deployment } from "../../platform/model";
import {
  FAILED_SHOWN_MS,
  LATE_AFTER_MS,
  hasOpenRequest,
  requestToShow,
} from "../requests";
import { requestState } from "../updates";

const NOW = Date.UTC(2026, 9, 27, 12);

const request = (fields: Partial<BackendRequest> = {}): BackendRequest => ({
  id: "r1",
  cafeId: "cafe1",
  ownerUid: "owner1",
  kind: "deploy",
  status: "queued",
  steps: [],
  detail: null,
  result: null,
  error: null,
  errorCode: null,
  deploymentId: null,
  createdAt: NOW - 60_000,
  finishedAt: null,
  ...fields,
});

describe("what the owner is told about a request", () => {
  it("says it is waiting for the next run, then that it is late, once the schedule looks paused", () => {
    expect(requestToShow([request()], NOW)?.stage).toBe("waiting");
    const old = request({ createdAt: NOW - LATE_AFTER_MS - 1 });
    expect(requestToShow([old], NOW)?.stage).toBe("late");
  });

  it("shows a worker's progress while it has the request", () => {
    const running = request({
      status: "running",
      createdAt: NOW - LATE_AFTER_MS * 3,
    });
    expect(requestToShow([running], NOW)).toEqual({
      request: running,
      stage: "working",
    });
  });

  it("tells of a failure for a day, and then lets it go", () => {
    const failed = request({
      status: "failed",
      error: "The cafe is not live.",
      finishedAt: NOW - 1000,
    });
    expect(requestToShow([failed], NOW)?.stage).toBe("failed");
    expect(requestToShow([failed], NOW + FAILED_SHOWN_MS)).toBeNull();
  });

  it("says nothing of a request that went through: the history has it", () => {
    expect(requestToShow([request({ status: "done" })], NOW)).toBeNull();
    expect(requestToShow([], NOW)).toBeNull();
  });

  it("is about the newest request, and leaves the setup wizard's checks to the wizard", () => {
    const check = request({ id: "c", kind: "check" });
    expect(requestToShow([check], NOW)).toBeNull();
    const newest = request({ id: "new", kind: "rollback", status: "running" });
    const older = request({ id: "old", status: "failed", finishedAt: NOW - 5 });
    expect(requestToShow([check, newest, older], NOW)?.request.id).toBe("new");
    // A newer finished one hides an older failure: it was tried again.
    const retried = request({ id: "again", status: "done" });
    expect(requestToShow([retried, older], NOW)).toBeNull();
  });
});

describe("one change at a time", () => {
  const cafe = { status: "live" as const };
  const none: Deployment[] = [];

  it("keeps the buttons off while a request is open, as for a running deployment", () => {
    expect(requestState(cafe, none, [request()])).toBe("busy");
    expect(requestState(cafe, none, [request({ status: "running" })])).toBe(
      "busy",
    );
    expect(requestState(cafe, none, [request({ status: "done" })])).toBe(
      "ready",
    );
    expect(requestState(cafe, none, [request({ status: "failed" })])).toBe(
      "ready",
    );
    expect(requestState(cafe, none)).toBe("ready");
  });

  it("does not count a connection check, which belongs to setup", () => {
    expect(hasOpenRequest([request({ kind: "check" })])).toBe(false);
    expect(hasOpenRequest([request({ kind: "sync-branding" })])).toBe(true);
  });

  it("stays 'not live' for a cafe that is not live", () => {
    expect(requestState({ status: "draft" }, none, [request()])).toBe(
      "not-live",
    );
  });
});

import { describe, expect, it } from "vitest";
import type { ConnectionResult } from "../connection";
import {
  WIZARD_STORAGE_KEY,
  answerFor,
  cafeToSetUp,
  canCheck,
  isConnected,
  loadWizard,
  parseSaved,
  resumeWizard,
  saveWizard,
  wizardReducer,
  type WizardEvent,
  type WizardState,
} from "../wizard";

const start: WizardState = {
  step: "project",
  projectId: "",
  check: { status: "idle" },
};
const run = (state: WizardState, ...events: WizardEvent[]) =>
  events.reduce(wizardReducer, state);
const answered = (
  projectId: string,
  result: ConnectionResult,
): WizardEvent => ({
  type: "check-answered",
  projectId,
  result,
  at: 1000,
});
const connected: ConnectionResult = { status: "connected" };
const noAccess: ConnectionResult = { status: "no-access" };

describe("the wizard", () => {
  it("goes from creating the project to giving access, and back", () => {
    const access = run(start, { type: "project-created" });
    expect(access.step).toBe("access");
    expect(run(access, { type: "back" }).step).toBe("project");
    expect(run(start, { type: "back" }).step).toBe("project");
  });

  it("checks only a well-formed project ID, one check at a time", () => {
    const access = run(start, { type: "project-created" });
    expect(canCheck(access)).toBe(false);
    expect(run(access, { type: "check-started" }).check.status).toBe("idle");
    const typed = run(access, {
      type: "project-id",
      value: " Lantern-Cafe-1A2B ",
    });
    expect(canCheck(typed)).toBe(true);
    const checking = run(typed, { type: "check-started" });
    expect(checking.check).toEqual({
      status: "checking",
      projectId: "lantern-cafe-1a2b",
    });
    expect(canCheck(checking)).toBe(false);
  });

  it("stays at access when the check finds a problem, and moves on when it passes", () => {
    const checking = run(
      start,
      { type: "project-created" },
      { type: "project-id", value: "lantern-cafe" },
      { type: "check-started" },
    );
    const refused = run(checking, answered("lantern-cafe", noAccess));
    expect(refused.step).toBe("access");
    expect(answerFor(refused)).toMatchObject({
      status: "answered",
      result: noAccess,
    });

    const passed = run(
      refused,
      { type: "check-started" },
      answered("lantern-cafe", connected),
    );
    expect(passed.step).toBe("connected");
    expect(isConnected(passed)).toBe(true);
    expect(run(passed, { type: "back" }).step).toBe("access");
  });

  it("drops an answer for an ID the owner has changed since", () => {
    const checking = run(
      start,
      { type: "project-created" },
      { type: "project-id", value: "lantern-cafe" },
      { type: "check-started" },
      { type: "project-id", value: "lantern-cafe-2" },
    );
    expect(run(checking, answered("lantern-cafe", connected)).step).toBe(
      "access",
    );
    expect(
      run(checking, {
        type: "check-failed",
        projectId: "lantern-cafe",
        error: "x",
      }).check.status,
    ).toBe("checking");
    // …and an old answer is not shown for the new ID.
    const old = run(
      { ...start, step: "access", projectId: "lantern-cafe" },
      answered("lantern-cafe", noAccess),
      { type: "project-id", value: "other-cafe" },
    );
    expect(answerFor(old)).toEqual({ status: "idle" });
  });

  it("keeps a check that could not run apart from one that answered", () => {
    const failed = run(
      { ...start, step: "access", projectId: "lantern-cafe" },
      { type: "check-started" },
      { type: "check-failed", projectId: "lantern-cafe", error: "offline" },
    );
    expect(failed.check).toEqual({
      status: "failed",
      projectId: "lantern-cafe",
      error: "offline",
    });
    expect(failed.step).toBe("access");
  });
});

describe("leaving and coming back", () => {
  it("comes back to the step it was on", () => {
    const state = run(
      start,
      { type: "project-created" },
      { type: "project-id", value: "lantern-cafe" },
    );
    saveWizard("cafe-1", state);
    expect(resumeWizard({ projectId: null }, loadWizard("cafe-1"))).toEqual(
      state,
    );
    expect(loadWizard("cafe-2")).toBeNull();
  });

  it("keeps the last answer, never a check in flight", () => {
    const checking = run(
      { ...start, step: "access", projectId: "lantern-cafe" },
      { type: "check-started" },
    );
    saveWizard("cafe-1", checking);
    expect(loadWizard("cafe-1")?.check).toBeNull();
    saveWizard("cafe-1", run(checking, answered("lantern-cafe", noAccess)));
    expect(loadWizard("cafe-1")?.check).toMatchObject({ result: noAccess });
  });

  it("starts from the cafe when this browser kept nothing", () => {
    expect(resumeWizard({ projectId: null }, null)).toEqual(start);
    expect(resumeWizard({ projectId: "lantern-cafe" }, null)).toEqual({
      step: "access",
      projectId: "lantern-cafe",
      check: { status: "idle" },
    });
  });

  it("never comes back connected without the answer to show it", () => {
    expect(
      resumeWizard(
        { projectId: "lantern-cafe" },
        { step: "connected", projectId: "lantern-cafe", check: null },
      ).step,
    ).toBe("access");
  });

  it("reads anything odd as nothing kept", () => {
    localStorage.setItem(WIZARD_STORAGE_KEY, "{broken");
    expect(loadWizard("cafe-1")).toBeNull();
    expect(parseSaved({ step: "launch", projectId: "x" })).toBeNull();
    expect(
      parseSaved({
        step: "access",
        projectId: "x",
        check: {
          status: "answered",
          projectId: "x",
          at: 1,
          result: { status: "maybe" },
        },
      }),
    ).toEqual({ step: "access", projectId: "x", check: null });
  });
});

describe("which cafe the page sets up", () => {
  const cafe = (id: string, status: "draft" | "live", createdAt: number) => ({
    id,
    status,
    createdAt,
  });
  const cafes = [
    cafe("old-draft", "draft", 1),
    cafe("live", "live", 3),
    cafe("new-draft", "draft", 2),
  ];

  it("is the one named, else the newest draft, else the newest", () => {
    expect(cafeToSetUp(cafes, "live")?.id).toBe("live");
    expect(cafeToSetUp(cafes, "someone-elses")?.id).toBe("new-draft");
    expect(cafeToSetUp(cafes, null)?.id).toBe("new-draft");
    expect(cafeToSetUp([cafe("live", "live", 3)], null)?.id).toBe("live");
    expect(cafeToSetUp([], null)).toBeNull();
  });
});

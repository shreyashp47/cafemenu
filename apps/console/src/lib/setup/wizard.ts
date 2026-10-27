/**
 * The onboarding wizard (#27) as a state machine: steps 3 and 4 of the
 * owner's steps (PLAN.md), for one draft cafe.
 *
 *   project    create a Firebase project on the free Spark plan
 *   access     paste its ID, add CafeMenu's deploy account, Check connection
 *   connected  the check passed; setup (#28) takes it from here
 *
 * Pure: the page dispatches events and shows the state. Where the owner is
 * comes back after they leave: the project ID is on the cafe itself (saved
 * before each check), and the step and the last check's answer are kept in
 * this browser (saveWizard). A step is never resumed past what is true: a
 * "connected" answer only counts for the project ID it was given for.
 */

import type { Cafe } from "../platform/model";
import { isPlainObject, isProjectId } from "../platform/validate";
import type { ConnectionResult } from "./connection";

export type WizardStep = "project" | "access" | "connected";

export type CheckState =
  | { status: "idle" }
  | { status: "checking"; projectId: string }
  /** The check ran and answered. */
  | {
      status: "answered";
      projectId: string;
      result: ConnectionResult;
      at: number;
    }
  /** The check could not run: offline, refused, not available yet. */
  | { status: "failed"; projectId: string; error: string };

export interface WizardState {
  step: WizardStep;
  /** As typed. */
  projectId: string;
  check: CheckState;
}

export type WizardEvent =
  | { type: "project-created" }
  | { type: "back" }
  | { type: "project-id"; value: string }
  | { type: "check-started" }
  | {
      type: "check-answered";
      projectId: string;
      result: ConnectionResult;
      at: number;
    }
  | { type: "check-failed"; projectId: string; error: string };

const IDLE: CheckState = { status: "idle" };

/** "  Lantern-Cafe-1A2B " as "lantern-cafe-1a2b": how the console shows IDs. */
export const cleanProjectId = (value: string) => value.trim().toLowerCase();

/** The check's answer counts only for the project ID it was asked about. */
export function answerFor(state: WizardState): CheckState {
  const id = cleanProjectId(state.projectId);
  const { check } = state;
  return check.status !== "idle" && check.projectId !== id ? IDLE : check;
}

export const isConnected = (state: WizardState) => {
  const answer = answerFor(state);
  return answer.status === "answered" && answer.result.status === "connected";
};

/** Whether Check connection may be pressed: a well-formed ID, not mid-check. */
export const canCheck = (state: WizardState) =>
  isProjectId(cleanProjectId(state.projectId)) &&
  state.check.status !== "checking";

export function wizardReducer(
  state: WizardState,
  event: WizardEvent,
): WizardState {
  switch (event.type) {
    case "project-created":
      return state.step === "project" ? { ...state, step: "access" } : state;
    case "back":
      return {
        ...state,
        step: state.step === "connected" ? "access" : "project",
      };
    case "project-id":
      return { ...state, projectId: event.value };
    case "check-started":
      if (!canCheck(state)) return state;
      return {
        ...state,
        check: {
          status: "checking",
          projectId: cleanProjectId(state.projectId),
        },
      };
    case "check-answered": {
      // An answer for an ID the owner has since changed is dropped.
      if (event.projectId !== cleanProjectId(state.projectId)) return state;
      const next: WizardState = {
        ...state,
        check: {
          status: "answered",
          projectId: event.projectId,
          result: event.result,
          at: event.at,
        },
      };
      return event.result.status === "connected"
        ? { ...next, step: "connected" }
        : next;
    }
    case "check-failed":
      if (event.projectId !== cleanProjectId(state.projectId)) return state;
      return {
        ...state,
        check: {
          status: "failed",
          projectId: event.projectId,
          error: event.error,
        },
      };
  }
}

// -- leaving and coming back -----------------------------------------------------

/** What is kept in this browser for one cafe. */
export interface SavedWizard {
  step: WizardStep;
  projectId: string;
  /** The last answer, never a check in flight or a failure to run one. */
  check: Extract<CheckState, { status: "answered" }> | null;
}

export function savedOf(state: WizardState): SavedWizard {
  return {
    step: state.step,
    projectId: state.projectId,
    check: state.check.status === "answered" ? state.check : null,
  };
}

/**
 * Where the owner comes back to: what this browser kept, checked against
 * the cafe. Without anything kept (another device), a cafe with a project
 * is at the access step, and one without at the start.
 */
export function resumeWizard(
  cafe: Pick<Cafe, "projectId">,
  saved: SavedWizard | null,
): WizardState {
  const projectId = saved?.projectId || cafe.projectId || "";
  const state: WizardState = {
    step: saved?.step ?? (cafe.projectId ? "access" : "project"),
    projectId,
    check: saved?.check ?? IDLE,
  };
  if (state.step === "connected" && !isConnected(state)) {
    return { ...state, step: "access" };
  }
  return state;
}

export const WIZARD_STORAGE_KEY = "cafemenu-console.setup.v1";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(): Record<string, unknown> {
  try {
    const raw = storage()?.getItem(WIZARD_STORAGE_KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return isPlainObject(data) ? data : {};
  } catch {
    return {};
  }
}

const STEPS: readonly WizardStep[] = ["project", "access", "connected"];

function parseResult(value: unknown): ConnectionResult | null {
  if (!isPlainObject(value)) return null;
  if (value.status === "connected" || value.status === "no-access") {
    return { status: value.status };
  }
  if (value.status === "missing" && Array.isArray(value.missing)) {
    return {
      status: "missing",
      missing: value.missing.filter(
        (m): m is { permission: string; why: string; neededBy: string[] } =>
          isPlainObject(m) &&
          typeof m.permission === "string" &&
          typeof m.why === "string" &&
          Array.isArray(m.neededBy),
      ),
    };
  }
  return null;
}

/** What was kept for `cafeId`, anything odd dropped. */
export function parseSaved(value: unknown): SavedWizard | null {
  if (!isPlainObject(value)) return null;
  const step = STEPS.find((s) => s === value.step);
  if (!step || typeof value.projectId !== "string") return null;
  let check: SavedWizard["check"] = null;
  const c = value.check;
  if (
    isPlainObject(c) &&
    c.status === "answered" &&
    typeof c.projectId === "string" &&
    typeof c.at === "number"
  ) {
    const result = parseResult(c.result);
    if (result) {
      check = { status: "answered", projectId: c.projectId, result, at: c.at };
    }
  }
  return { step, projectId: value.projectId, check };
}

export function loadWizard(cafeId: string): SavedWizard | null {
  return parseSaved(readAll()[cafeId]);
}

export function saveWizard(cafeId: string, state: WizardState) {
  try {
    const all = readAll();
    all[cafeId] = savedOf(state);
    storage()?.setItem(WIZARD_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage off or full: the step is lost on reload, the project ID not.
  }
}

// -- which cafe ------------------------------------------------------------------

/**
 * The cafe the page sets up: the one named in the address (`?cafe=`) if it
 * is the owner's, else their newest draft, else their newest cafe.
 */
export function cafeToSetUp<
  C extends Pick<Cafe, "id" | "status" | "createdAt">,
>(cafes: readonly C[], wanted: string | null): C | null {
  const named = wanted ? cafes.find((c) => c.id === wanted) : undefined;
  if (named) return named;
  const newest = [...cafes].sort((a, b) => b.createdAt - a.createdAt);
  return newest.find((c) => c.status === "draft") ?? newest[0] ?? null;
}

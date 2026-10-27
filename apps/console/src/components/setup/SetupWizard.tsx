"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { DataBundle } from "@/lib/data/types";
import { errorText } from "@/lib/messages";
import type { BackendRequest, Cafe } from "@/lib/platform/model";
import {
  canCheck,
  cleanProjectId,
  loadWizard,
  resumeWizard,
  saveWizard,
  wizardReducer,
  type WizardStep,
} from "@/lib/setup/wizard";
import { Connected } from "./Connected";
import { CreateProject } from "./CreateProject";
import { GiveAccess } from "./GiveAccess";
import { SetupSteps } from "./SetupSteps";

/** Which of the five steps each wizard step is. */
const STEP_NUMBER: Record<WizardStep, number> = {
  project: 3,
  access: 4,
  connected: 5,
};

/**
 * Steps 3 and 4 for one draft cafe, from wizard.ts's state machine. Where
 * the owner is goes to this browser on every change, and the project ID to
 * the cafe before each check, so leaving and coming back lands on the same
 * step.
 */
export function SetupWizard({ data, cafe }: { data: DataBundle; cafe: Cafe }) {
  const [state, dispatch] = useReducer(wizardReducer, cafe, (c) =>
    resumeWizard(c, loadWizard(c.id)),
  );
  useEffect(() => saveWizard(cafe.id, state), [cafe.id, state]);

  // The heading takes the focus once the step has changed, not on arrival.
  const first = useRef(state.step);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (state.step !== first.current) setMoved(true);
  }, [state.step]);

  // Where a check that is a request to the backend has got (#77): it takes
  // minutes, so the page says so and follows it.
  const [progress, setProgress] = useState<BackendRequest | null>(null);

  const saved = cafe.projectId;
  const check = useCallback(async () => {
    if (!canCheck(state)) return;
    const projectId = cleanProjectId(state.projectId);
    dispatch({ type: "check-started" });
    setProgress(null);
    try {
      // Saved first, so it is kept even when the check cannot run yet.
      if (saved !== projectId) {
        await data.cafes.connectProject(cafe.id, projectId);
      }
      const result = await data.connection.check(
        { id: cafe.id, projectId },
        { onProgress: setProgress },
      );
      dispatch({ type: "check-answered", projectId, result, at: Date.now() });
    } catch (error) {
      dispatch({ type: "check-failed", projectId, error: errorText(error) });
    } finally {
      setProgress(null);
    }
  }, [data, cafe.id, saved, state]);

  const back = () => dispatch({ type: "back" });

  return (
    <div className="space-y-6">
      <SetupSteps current={STEP_NUMBER[state.step]} />
      {state.step === "project" && (
        <CreateProject
          cafeName={cafe.settings.name}
          focus={moved}
          onDone={() => dispatch({ type: "project-created" })}
        />
      )}
      {state.step === "access" && (
        <GiveAccess
          state={state}
          demo={data.backend !== "firebase"}
          queued={data.requests !== null}
          progress={progress}
          focus={moved}
          onProjectId={(value) => dispatch({ type: "project-id", value })}
          onCheck={check}
          onBack={back}
        />
      )}
      {state.step === "connected" && (
        <Connected
          cafeName={cafe.settings.name}
          projectId={cleanProjectId(state.projectId)}
          focus={moved}
          onBack={back}
        />
      )}
    </div>
  );
}

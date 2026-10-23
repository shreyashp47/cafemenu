"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataBundle } from "@/lib/data/types";
import { errorText, messages, problemText } from "@/lib/messages";
import { CafeInputError, SetupInputError } from "@/lib/platform/validate";
import type { SignupDraft } from "@/lib/signup/draft";
import { saveCafe, type SavedCafe } from "@/lib/signup/flow";
import { Button } from "../Button";
import { StageHeading } from "../StageHeading";

const { create: text } = messages.signup;

function failureText(error: unknown): string {
  if (error instanceof CafeInputError || error instanceof SetupInputError) {
    return error.problems.map(problemText).join(" ");
  }
  return errorText(error);
}

/**
 * Saves the cafe, its logo and its menu, once, as soon as it is shown. A
 * failure part-way keeps the cafe's id in the draft, so "Try again" carries
 * on rather than making a second cafe.
 */
export function SavingCafe({
  data,
  draft,
  focus,
  onCafeId,
  onSaved,
}: {
  data: DataBundle;
  draft: SignupDraft;
  focus: boolean;
  onCafeId: (cafeId: string) => void;
  onSaved: (cafe: SavedCafe) => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const running = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;

  const run = useCallback(async () => {
    // React runs effects twice in development; a cafe is made once.
    if (running.current) return;
    running.current = true;
    setFailure(null);
    try {
      onSaved(await saveCafe(data, latest.current, onCafeId));
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      running.current = false;
    }
  }, [data, onCafeId, onSaved]);

  // Once, when shown; "Try again" runs it after that.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <div className="border-line bg-surface shadow-card space-y-5 rounded-xl border p-5 sm:p-8">
      <StageHeading
        title={failure ? text.failed : text.title}
        focus={focus || failure !== null}
      />
      <div aria-live="polite">
        {failure && <p className="text-danger font-medium">{failure}</p>}
      </div>
      {failure && <Button onClick={run}>{text.retry}</Button>}
    </div>
  );
}

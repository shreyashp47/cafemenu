"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useDataBundle } from "@/lib/data/hooks";
import { messages } from "@/lib/messages";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type SignupDraft,
} from "@/lib/signup/draft";
import { menuOf } from "@/lib/signup/form";
import {
  signupStage,
  type SavedCafe,
  type SignupStage,
} from "@/lib/signup/flow";
import { DemoNotice } from "../DemoNotice";
import { SavingCafe } from "./SavingCafe";
import { SignupDone } from "./SignupDone";
import { SignupForm } from "./SignupForm";
import { StageHeading } from "./StageHeading";
import { VerifyEmail } from "./VerifyEmail";

const { signup } = messages;

/**
 * Sign-up from start to a saved draft cafe (PLAN.md, "The owner's steps", 1
 * and 2): the form, the email link, then saving. Which of them shows follows
 * from the account and the draft in this browser (signupStage), so a reload
 * or a return comes back to the same place.
 */
export function SignupFlow() {
  const data = useDataBundle();
  const { ready, user } = useAccount(data);
  const [draft, setDraft] = useState<SignupDraft | null>(null);
  const [draftRead, setDraftRead] = useState(false);
  const [saved, setSaved] = useState<{
    cafe: SavedCafe;
    region: string;
    menuCount: number;
  } | null>(null);

  const stage = signupStage({
    ready: ready && draftRead && data !== null,
    user,
    draft,
    created: saved?.cafe ?? null,
  });

  // Headings take the focus once the stage has changed, not on first load.
  const firstStage = useRef<SignupStage | null>(null);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (stage === "loading") return;
    if (firstStage.current === null) firstStage.current = stage;
    else if (stage !== firstStage.current) setMoved(true);
  }, [stage]);

  // The draft as last saved, for the callbacks below: saving happens here,
  // never inside a state updater, which React may run after a later clear.
  const current = useRef<SignupDraft | null>(null);
  const keep = useCallback((next: SignupDraft | null) => {
    current.current = next;
    if (next) saveDraft(next);
    else clearDraft();
    setDraft(next);
  }, []);
  useEffect(() => {
    current.current = loadDraft();
    setDraft(current.current);
    setDraftRead(true);
  }, []);

  const onCafeId = useCallback(
    (cafeId: string) => {
      if (current.current) keep({ ...current.current, cafeId });
    },
    [keep],
  );

  const onSaved = useCallback(
    (cafe: SavedCafe) => {
      const sent = current.current;
      setSaved({
        cafe,
        region: sent?.form.region ?? "",
        menuCount: sent ? menuOf({ ...sent.form, password: "" }).count : 0,
      });
      keep(null);
    },
    [keep],
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
      {data?.backend === "demo" && <DemoNotice />}
      {stage === "loading" && (
        <p role="status" className="text-muted">
          {signup.loading}
        </p>
      )}
      {stage === "form" && data && (
        <>
          <div>
            <StageHeading
              eyebrow={signup.eyebrow}
              title={signup.title}
              focus={moved}
            />
            <p className="text-text mt-4 text-lg">{signup.lead}</p>
          </div>
          <SignupForm data={data} user={user} draft={draft} onSent={keep} />
        </>
      )}
      {stage === "verify" && data && user && (
        <VerifyEmail
          data={data}
          user={user}
          hasDraft={draft !== null}
          focus={moved}
        />
      )}
      {stage === "create" && data && draft && (
        <SavingCafe
          data={data}
          draft={draft}
          focus={moved}
          onCafeId={onCafeId}
          onSaved={onSaved}
        />
      )}
      {stage === "done" && saved && (
        <SignupDone
          cafe={saved.cafe}
          region={saved.region}
          menuCount={saved.menuCount}
          focus={moved}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { demoVerifyEmail } from "@/lib/data/demo";
import type { DataBundle } from "@/lib/data/types";
import { errorText, fill, messages } from "@/lib/messages";
import type { PlatformUser } from "@/lib/platform/model";
import { Button, TextButton } from "../Button";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { continueUrl } from "./continue-url";

const { verify: text } = messages.signup;

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "not-yet" }
  | { kind: "resent" }
  | { kind: "failed"; message: string };

/** Whether the account is verified now, after a fresh token. */
function verifiedNow(data: DataBundle): Promise<boolean> {
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    let done = false;
    stop = data.auth.subscribe((user) => {
      if (done) return;
      done = true;
      resolve(user?.emailVerified === true);
      // After this call returns, even when the listener ran inside it.
      queueMicrotask(() => stop?.());
    });
  });
}

/**
 * Step 2: the link in the email. The rules refuse every write until it is
 * clicked, so nothing is saved before. Checks again when the owner comes
 * back to the tab, and when they say they have clicked it.
 */
export function VerifyEmail({
  data,
  user,
  hasDraft,
  focus,
}: {
  data: DataBundle;
  user: PlatformUser;
  hasDraft: boolean;
  focus: boolean;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** A verified account moves the page on by itself, through `user`. */
  const check = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setStatus({ kind: "checking" });
      try {
        await data.auth.refresh();
        const verified = await verifiedNow(data);
        if (!verified && !quiet && live.current) setStatus({ kind: "not-yet" });
      } catch (error) {
        if (!quiet && live.current) {
          setStatus({ kind: "failed", message: errorText(error) });
        }
      }
    },
    [data],
  );

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "visible") void check(true);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [check]);

  const resend = async () => {
    try {
      await data.auth.sendVerificationEmail(continueUrl());
      setStatus({ kind: "resent" });
    } catch (error) {
      setStatus({ kind: "failed", message: errorText(error) });
    }
  };

  // Signed out, the page goes back to the form, filled in from the draft.
  const restart = () => data.auth.signOut();

  return (
    <div className="border-line bg-surface shadow-card space-y-5 rounded-xl border p-5 sm:p-8">
      <StageHeading eyebrow={text.eyebrow} title={text.title} focus={focus} />
      <p className="text-text text-lg">
        <Rich text={fill(text.text, { email: user.email })} />
      </p>
      <p className="text-muted">{hasDraft ? text.kept : text.noDraft}</p>

      {data.backend === "demo" && (
        <div className="border-line bg-accent-soft rounded-md border p-4">
          <p className="text-accent-ink text-sm">{text.demo}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              demoVerifyEmail();
              void check(true);
            }}
          >
            {text.demoVerify}
          </Button>
        </div>
      )}
      {data.backend === "emulators" && (
        <p className="text-muted text-sm">{text.emulators}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => check(false)}
          disabled={status.kind === "checking"}
        >
          {status.kind === "checking" ? text.checking : text.check}
        </Button>
        <Button variant="secondary" onClick={resend}>
          {text.resend}
        </Button>
      </div>
      <div aria-live="polite" className="min-h-6">
        {status.kind === "not-yet" && <p className="text-ink">{text.notYet}</p>}
        {status.kind === "resent" && (
          <p className="text-brand-ink font-medium">{text.resent}</p>
        )}
        {status.kind === "failed" && (
          <p className="text-danger font-medium">{status.message}</p>
        )}
      </div>
      <TextButton onClick={restart}>{text.restart}</TextButton>
    </div>
  );
}

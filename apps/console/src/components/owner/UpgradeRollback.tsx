"use client";

import { useEffect, useRef, useState } from "react";
import type { DataBundle } from "@/lib/data/types";
import { formatDate } from "@/lib/format";
import { errorText, fill, messages } from "@/lib/messages";
import type { Cafe, Release } from "@/lib/platform/model";
import { minorLineOf } from "@/lib/platform/validate";
import {
  releaseOf,
  rollbackTarget,
  upgradeOffer,
  type RequestState,
} from "@/lib/owner/updates";
import { Button, TextButton } from "../Button";
import { Rich } from "../Rich";
import { ReleaseNotes } from "./ReleaseNotes";

const { offer, rollback, notes, request } = messages.cafe.updates;

/** What the two buttons do, and why one may not work right now. */
function whyNot(state: RequestState): string | null {
  if (state === "busy") return request.busy;
  if (state === "not-live") return request.notLive;
  return null;
}

/**
 * Upgrade and Roll back: asks the backend to deploy now (DeployRequests),
 * and says what it asked. The result shows in the deployment list, which the
 * page watches; the version on show changes when the backend finishes.
 */
export function UpgradeRollback({
  data,
  cafe,
  releases,
  state,
}: {
  data: DataBundle;
  cafe: Cafe;
  /** Null while the releases load. */
  releases: Release[] | null;
  state: RequestState;
}) {
  const [busy, setBusy] = useState<"upgrade" | "rollback" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // "Asked" is old news once what was asked for has finished.
  const before = useRef(state);
  useEffect(() => {
    if (before.current === "busy" && state === "ready") {
      setMessage((m) => (m?.ok ? null : m));
    }
    before.current = state;
  }, [state]);

  const { current } = cafe.release;
  const offered = releases ? upgradeOffer(cafe.release, releases) : null;
  const previous = rollbackTarget(cafe.release);
  const reason = whyNot(state);
  const idle = state === "ready" && busy === null;
  const currentRelease = releases ? releaseOf(current, releases) : null;

  const run = async (
    which: "upgrade" | "rollback",
    ask: () => Promise<unknown>,
  ) => {
    setBusy(which);
    setMessage(null);
    try {
      await ask();
      setMessage({ ok: true, text: request.sent });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  const noteFor = (release: Release) => (
    <details className="mt-3">
      <summary className="text-brand-ink min-h-tap inline-flex cursor-pointer items-center font-medium underline underline-offset-4">
        {fill(notes.show, { version: release.version })}
      </summary>
      <div className="mt-2">
        <ReleaseNotes notes={release.notes} />
      </div>
    </details>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {!releases && current && <p className="text-muted">{notes.loading}</p>}
        {offered && (
          <div className="border-line rounded-lg border p-4">
            <h3 className="text-ink text-lg font-semibold">
              {fill(offer.title, { version: offered.release.version })}
              {offered.release.channel === "beta" && (
                <span className="text-muted font-normal"> {offer.beta}</span>
              )}
            </h3>
            <p className="text-muted text-sm">
              {fill(offer.published, {
                date: formatDate(offered.release.publishedAt),
              })}
            </p>
            {offered.movesLine && cafe.release.pinned && (
              <p className="text-text mt-2">
                {fill(offer.movesLine, {
                  line: cafe.release.pinned,
                  next: minorLineOf(offered.release.version) ?? "",
                })}
              </p>
            )}
            {noteFor(offered.release)}
            <div className="mt-4">
              <Button
                disabled={!idle}
                onClick={() =>
                  run("upgrade", () =>
                    data.deploys.upgrade(cafe, offered.release.version),
                  )
                }
              >
                {fill(offer.upgrade, { version: offered.release.version })}
              </Button>
            </div>
          </div>
        )}
        {releases && !offered && (
          <p className="text-text">{current ? offer.upToDate : offer.none}</p>
        )}
        {currentRelease && !offered && noteFor(currentRelease)}
      </div>

      <div className="space-y-3">
        <h3 className="text-ink text-lg font-semibold">{rollback.title}</h3>
        {previous ? (
          <>
            <p className="text-text">
              <Rich text={fill(rollback.text, { version: previous })} />
            </p>
            {!confirming ? (
              <Button
                variant="secondary"
                disabled={!idle}
                onClick={() => setConfirming(true)}
              >
                {fill(rollback.button, { version: previous })}
              </Button>
            ) : (
              <div
                role="group"
                aria-labelledby="rollback-confirm"
                className="border-line bg-sunk space-y-3 rounded-lg border p-4"
              >
                <p id="rollback-confirm" className="text-ink font-semibold">
                  {fill(rollback.confirm, { version: previous })}
                </p>
                <p className="text-text">
                  {fill(rollback.confirmText, { version: previous })}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    ref={confirmRef}
                    disabled={!idle}
                    onClick={() =>
                      run("rollback", () => data.deploys.rollback(cafe))
                    }
                  >
                    {rollback.yes}
                  </Button>
                  <TextButton onClick={() => setConfirming(false)}>
                    {rollback.cancel}
                  </TextButton>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted">{rollback.none}</p>
        )}
      </div>

      <p
        role="status"
        className={
          message?.ok === false
            ? "text-danger font-medium"
            : "text-brand-ink font-medium"
        }
      >
        {message?.text ?? (idle ? "" : reason)}
      </p>
    </div>
  );
}

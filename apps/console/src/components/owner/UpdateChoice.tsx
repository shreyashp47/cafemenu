"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { DataBundle } from "@/lib/data/types";
import { errorText, fill, messages } from "@/lib/messages";
import type { Cafe } from "@/lib/platform/model";
import {
  choiceFor,
  choiceOf,
  sameChoice,
  updateModeOf,
  updateOptions,
  type UpdateMode,
} from "@/lib/owner/updates";
import { Button } from "../Button";
import { FieldGroup } from "../form/Field";

const { choice: text } = messages.cafe.updates;

/**
 * How the cafe follows releases: stable, beta, or staying on one minor line.
 * Saved on the cafe's record, which the owner may write (the rules pin
 * `release.channel` and `release.pinned` as theirs); the backend deploys what
 * the choice says when a version comes out.
 */
export function UpdateChoice({ data, cafe }: { data: DataBundle; cafe: Cafe }) {
  const saved = updateModeOf(cafe.release);
  const [mode, setMode] = useState<UpdateMode>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // The record changed under us (another tab, or an upgrade that moved the
  // line): show what is true.
  useEffect(() => setMode(saved), [saved, cafe.release.pinned]);

  const options = updateOptions(cafe.release);
  const wanted = choiceFor(cafe.release, mode);
  const unchanged = sameChoice(wanted, choiceOf(cafe.release));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    setBusy(true);
    setMessage(null);
    try {
      await data.cafes.chooseRelease(cafe.id, wanted);
      setMessage({ ok: true, text: text.saved });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <FieldGroup id="updates-choice" legend={text.legend}>
        <div className="space-y-3">
          {options.map((option) => {
            const words = text[option.mode];
            const title =
              option.mode === "pinned"
                ? fill(text.pinned.title, { line: option.line ?? "" })
                : words.title;
            const body =
              option.mode === "pinned"
                ? option.disabled
                  ? text.pinned.none
                  : fill(text.pinned.text, { line: option.line ?? "" })
                : words.text;
            return (
              <label
                key={option.mode}
                className="border-line-field has-checked:border-brand has-checked:bg-brand-soft has-focus-visible:outline-ring has-disabled:bg-sunk flex cursor-pointer gap-3 rounded-lg border p-3 has-checked:border-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-disabled:cursor-not-allowed"
              >
                <input
                  type="radio"
                  name="updates-choice"
                  value={option.mode}
                  checked={mode === option.mode}
                  disabled={option.disabled}
                  onChange={() => setMode(option.mode)}
                  className="accent-brand mt-1 h-5 w-5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="text-ink block font-semibold">{title}</span>
                  <span className="text-muted block text-sm">{body}</span>
                </span>
              </label>
            );
          })}
        </div>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || unchanged}>
          {busy ? text.saving : text.save}
        </Button>
        <p
          role="status"
          className={
            message?.ok === false
              ? "text-danger font-medium"
              : "text-brand-ink font-medium"
          }
        >
          {message?.text}
        </p>
      </div>
    </form>
  );
}

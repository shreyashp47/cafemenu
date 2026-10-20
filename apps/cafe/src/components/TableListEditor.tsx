"use client";

/**
 * The owner's "how many tables" control on /admin/qr.
 *
 * The owner is not assumed to be technical (docs/requirements.md §2), so the
 * everyday case is a single number with − and + buttons: "8" means tables 1 to
 * 8. A cafe that skips a number (no table 13) or numbers its terrace from 20
 * can switch to typing the list out, ranges allowed. Both land in the same
 * saved list, config/tables, which the customer's table picker follows live.
 *
 * Kept free of the data layer so it can be tested on its own: the page hands in
 * the current list and a save function.
 */

import { useState } from "react";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import {
  MAX_TABLE_NUMBER,
  formatTableList,
  isSimpleRun,
  parseTableText,
  tablesUpTo,
} from "@/lib/tables";

// Both fields are kept whichever mode is showing, so flipping between the two
// never throws away what the owner typed in the other.
interface Draft {
  mode: "count" | "custom";
  count: string;
  text: string;
}

function draftFrom(tables: number[]): Draft {
  return {
    mode: isSimpleRun(tables) ? "count" : "custom",
    count: String(tables.length),
    text: formatTableList(tables),
  };
}

/** The list a draft stands for, or the reason it cannot be saved. */
function readDraft(draft: Draft): { tables: number[] } | { error: string } {
  if (draft.mode === "count") {
    const n = Number(draft.count.trim());
    if (!/^\d+$/.test(draft.count.trim()) || n < 1 || n > MAX_TABLE_NUMBER) {
      return {
        error: `Choose a number of tables from 1 to ${MAX_TABLE_NUMBER}.`,
      };
    }
    return { tables: tablesUpTo(n) };
  }
  const { tables, rejected } = parseTableText(draft.text);
  if (rejected.length > 0) {
    return {
      error: `Can't use ${rejected.map((r) => `"${r}"`).join(", ")}. Table numbers go from 1 to ${MAX_TABLE_NUMBER}.`,
    };
  }
  if (tables.length === 0) return { error: "Add at least one table." };
  return { tables };
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((n, i) => n === b[i]);

export function TableListEditor({
  tables,
  saved,
  loading,
  onSave,
}: {
  /** The list in force: the saved one, or the default. */
  tables: number[];
  /** `null` while the default is in use and nothing has been saved yet. */
  saved: number[] | null;
  loading: boolean;
  onSave: (tables: number[]) => Promise<void>;
}) {
  // null means "untouched": the form shows whatever is live, so a save from
  // another device shows up here too instead of being hidden behind a stale
  // copy taken when the page opened.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  if (loading) {
    return <p className="text-muted text-sm">Loading your tables…</p>;
  }

  const current = draft ?? draftFrom(tables);
  const result = readDraft(current);
  const next = "tables" in result ? result.tables : null;
  // Saving the default as-is is still worth allowing: it pins the list so a
  // later change to the env default cannot move the cafe's tables.
  const dirty = next !== null && (saved === null || !same(next, tables));

  const edit = (patch: Partial<Draft>) => {
    setState("idle");
    setDraft({ ...current, ...patch });
  };

  const count = Number(current.count) || 0;
  const step = (by: number) =>
    edit({
      count: String(
        Math.min(Math.max((count || tables.length) + by, 1), MAX_TABLE_NUMBER),
      ),
    });

  async function save() {
    if (!next) return;
    setState("saving");
    try {
      await onSave(next);
      setDraft(null);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {current.mode === "count" ? (
        <Field
          label="Number of tables"
          htmlFor="table-count"
          hint={
            next
              ? `Tables are numbered 1 to ${next.length}.`
              : `From 1 to ${MAX_TABLE_NUMBER}.`
          }
        >
          <div className="flex max-w-xs items-center gap-2">
            <StepButton
              label="One table fewer"
              icon="minus"
              onClick={() => step(-1)}
              disabled={count <= 1}
            />
            <Input
              id="table-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TABLE_NUMBER}
              value={current.count}
              onChange={(e) => edit({ count: e.target.value })}
              className="tnum text-center text-lg"
            />
            <StepButton
              label="One table more"
              icon="plus"
              onClick={() => step(1)}
              disabled={count >= MAX_TABLE_NUMBER}
            />
          </div>
        </Field>
      ) : (
        <Field
          label="Table numbers"
          htmlFor="table-list"
          hint="Separate with commas. A dash covers a run, e.g. 1-8, 12, 14"
        >
          <Input
            id="table-list"
            value={current.text}
            onChange={(e) => edit({ text: e.target.value })}
            placeholder="1-8, 12, 14"
          />
        </Field>
      )}

      <button
        type="button"
        className="text-primary-dark self-start text-sm font-semibold underline underline-offset-2"
        onClick={() =>
          edit(
            current.mode === "count"
              ? {
                  mode: "custom",
                  text: formatTableList(next ?? tables),
                }
              : {
                  mode: "count",
                  count: String((next ?? tables).length),
                },
          )
        }
      >
        {current.mode === "count"
          ? "Skip a number or start higher? Type the table numbers instead"
          : "Just number my tables 1, 2, 3…"}
      </button>

      {"error" in result ? (
        <p role="alert" className="text-berry-deep text-sm font-semibold">
          {result.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void save()}
          disabled={!dirty || state === "saving"}
        >
          {state === "saving" ? "Saving…" : "Save tables"}
        </Button>
        {state === "saved" ? (
          <p role="status" className="text-sm font-semibold">
            Saved ✓ Customers now see these tables.
          </p>
        ) : state === "error" ? (
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            That didn&apos;t save. Check your connection and try again.
          </p>
        ) : dirty && saved !== null ? (
          <p className="text-muted text-sm">
            Not saved yet. The cards below still show the saved tables.
          </p>
        ) : saved === null ? (
          <p className="text-muted text-sm">
            Using the default ({formatTableList(tables)}) until you save.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A round 48px − / + button, drawn with the app's icons like the customer's
 * quantity stepper. The bare "−" and "+" characters it replaces rendered small
 * and thin, and looked like text rather than something to tap.
 */
function StepButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: "plus" | "minus";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-pill border-primary bg-paper text-primary hover:bg-highlight-soft/60 focus-visible:outline-ring grid size-12 shrink-0 place-items-center border-2 transition-transform focus-visible:outline-3 active:scale-90 disabled:pointer-events-none disabled:opacity-45"
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

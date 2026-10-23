"use client";

import { useState, type ChangeEvent } from "react";
import { STARTER_MENUS } from "@cafemenu/shared";
import { fill, messages } from "@/lib/messages";
import {
  importSettingsOf,
  menuOf,
  type FieldProblems,
  type SignupForm,
} from "@/lib/signup/form";
import { listStart, needsList, type MenuChoice } from "@/lib/signup/menu";
import { FieldGroup, controlClass, controlProps } from "../form/Field";
import { FilePicker } from "../form/FilePicker";

const { menu: text } = messages.signup;
const problemText = messages.signup.problems.menu;

/** The most of a CSV file read, well past 200 rows of a menu. */
const MAX_LIST_BYTES = 512 * 1024;
/** Rows with problems listed under the box; the rest are counted. */
const ROWS_SHOWN = 8;

const sameChoice = (a: MenuChoice, b: MenuChoice) =>
  a.kind === b.kind &&
  (a.kind !== "template" || (b.kind === "template" && a.id === b.id));

/**
 * A starter menu, the owner's own list (pasted, or a CSV file), or nothing.
 * The list is read as it is typed by the import the cafe app uses.
 */
export function MenuFields({
  form,
  onChange,
  problems,
}: {
  form: SignupForm;
  onChange: (form: SignupForm) => void;
  problems: FieldProblems;
}) {
  const [fileProblem, setFileProblem] = useState(false);
  const settings = importSettingsOf(form);
  const list = needsList(form.menu, settings);
  const result = menuOf(form);
  const error = problems.menu ? problemText[problems.menu] : undefined;

  const choose = (menu: MenuChoice) => {
    if (sameChoice(menu, form.menu)) return;
    const startText =
      menu.kind === "template" && needsList(menu, settings)
        ? listStart(menu, settings)
        : menu.kind === "import"
          ? form.menu.kind === "import"
            ? form.menuText
            : ""
          : form.menuText;
    onChange({ ...form, menu, menuText: startText });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileProblem(false);
    if (file.size > MAX_LIST_BYTES) {
      setFileProblem(true);
      return;
    }
    try {
      onChange({ ...form, menuText: await file.text() });
    } catch {
      setFileProblem(true);
    }
  };

  const options: { choice: MenuChoice; label: string; hint: string }[] = [
    ...STARTER_MENUS.map((m) => ({
      choice: { kind: "template", id: m.id } as MenuChoice,
      label: m.name,
      hint: `${m.blurb} ${fill(text.items, { count: m.items.length })}.`,
    })),
    { choice: { kind: "import" }, label: text.import, hint: text.importHint },
    { choice: { kind: "blank" }, label: text.blank, hint: text.blankHint },
  ];

  const bad = result.rows.filter((row) => row.problems.length > 0);
  const listError = error ?? (fileProblem ? text.fileProblem : undefined);

  return (
    <>
      <FieldGroup id="signup-menu" legend={text.label}>
        <div className="space-y-2">
          {options.map(({ choice, label, hint }, i) => (
            <label
              key={label}
              className="border-line-field has-checked:border-brand has-checked:bg-brand-soft flex cursor-pointer gap-3 rounded-lg border p-3 has-checked:border-2"
            >
              <input
                id={i === 0 ? "signup-menu-first" : undefined}
                type="radio"
                name="menu"
                checked={sameChoice(choice, form.menu)}
                onChange={() => choose(choice)}
                className="accent-brand mt-1 h-5 w-5 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-ink block font-semibold">{label}</span>
                <span className="text-muted block text-sm">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </FieldGroup>

      {list && (
        <div>
          <label
            htmlFor="signup-menu-list"
            className="text-ink block font-semibold"
          >
            {text.list}
          </label>
          <p id="signup-menu-list-hint" className="text-muted mt-1 text-sm">
            {form.menu.kind === "template"
              ? `${fill(text.unpriced, { currency: settings.currency })} `
              : ""}
            {text.listHint}
          </p>
          <textarea
            value={form.menuText}
            onChange={(e) => onChange({ ...form, menuText: e.target.value })}
            rows={8}
            spellCheck={false}
            {...controlProps("signup-menu-list", {
              hint: true,
              error: listError,
            })}
            aria-describedby={[
              listError ? "signup-menu-list-error" : "",
              "signup-menu-list-hint",
              "signup-menu-list-status",
            ]
              .filter(Boolean)
              .join(" ")}
            className={`${controlClass} mt-2 py-2 font-mono text-sm`}
          />
          {listError && (
            <p
              id="signup-menu-list-error"
              className="text-danger mt-2 text-sm font-medium"
            >
              {listError}
            </p>
          )}
          <div className="mt-3">
            <FilePicker
              id="signup-menu-file"
              label={text.upload}
              accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
              onChange={onFile}
            />
          </div>
          <div
            id="signup-menu-list-status"
            aria-live="polite"
            className="mt-3 text-sm"
          >
            {result.count > 0 && bad.length === 0 && (
              <p className="text-brand-ink font-medium">
                {fill(text.ready, { count: result.count })}
              </p>
            )}
            {bad.length > 0 && (
              <div className="bg-danger-soft rounded-md p-3">
                <p className="text-danger font-medium">
                  {fill(text.rowsToFix, { count: bad.length })}
                </p>
                <ul className="text-ink mt-1 list-disc space-y-1 pl-5">
                  {bad.slice(0, ROWS_SHOWN).map((row) => (
                    <li key={row.row}>
                      <span className="font-semibold">
                        {fill(text.row, { row: row.row })}
                        {row.name ? ` · ${row.name}` : ""}
                      </span>
                      : {row.problems.join(" ")}
                    </li>
                  ))}
                </ul>
                {bad.length > ROWS_SHOWN && (
                  <p className="text-ink mt-1">
                    {fill(text.more, { count: bad.length - ROWS_SHOWN })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {!list && error && (
        <p className="text-danger text-sm font-medium">{error}</p>
      )}
    </>
  );
}

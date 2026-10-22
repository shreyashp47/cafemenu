"use client";

/**
 * Menu import and starter menus on /admin (issue #16).
 *
 * The owner pastes rows from a spreadsheet, chooses a CSV file, or picks a
 * starter menu, and sees every row checked before anything is written:
 * which are ready, and what is wrong with the rest, row by row. Importing
 * adds the ready ones in one batch and leaves the others in the box, so the
 * owner fixes them there and imports again. The menu already there is kept
 * unless the owner chooses to replace it.
 *
 * The checking is readMenuImport in @cafemenu/shared, the same one the
 * console's signup uses, and so are the starter menus. A starter menu is just
 * CSV in the box: the owner sees and can edit exactly what will be added.
 */

import { useMemo, useRef, useState } from "react";

import {
  MENU_COLUMNS,
  STARTER_MENUS,
  currencySymbol,
  hasStarterPrices,
  moneyDigits,
  readMenuImport,
  starterMenuCsv,
  type MenuImportRow,
} from "@cafemenu/shared";

import { Icon } from "@/components/icons";
import { useMenuRepo } from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import type { MenuItem } from "@/lib/types";

/** Far more than any menu's CSV; a bigger file is not one. */
const MAX_FILE_BYTES = 1_000_000;

/** The file as text: UTF-8, as spreadsheets save CSV. */
function fileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function MenuImportCard({
  menu,
  initialText = "",
  onClose,
}: {
  /** The menu as it is now, to keep imports from repeating its names. */
  menu: MenuItem[];
  initialText?: string;
  onClose: () => void;
}) {
  const repo = useMenuRepo();
  const { settings } = useCafeSettings();
  const [text, setText] = useState(initialText);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const result = useMemo(
    () =>
      readMenuImport(
        text,
        settings,
        replace
          ? {}
          : {
              existingNames: menu.map((i) => i.name),
              existingCategories: [...new Set(menu.map((i) => i.category))],
            },
      ),
    [text, settings, replace, menu],
  );
  const toFix = result.rows.filter((r) => !r.item);
  const ready = result.rows.filter((r) => r.item);
  const count = result.items.length;

  const digits = moneyDigits(settings);
  const symbol = currencySymbol(settings);

  /** Selects the row in the box, for the owner to correct. */
  function fix(row: MenuImportRow) {
    const area = box.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(row.start, row.end);
  }

  async function readFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setDone(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is too big to be a menu. Choose its CSV file.`);
      return;
    }
    try {
      setText(await fileText(file));
      setError(null);
    } catch {
      setError(`Couldn't read ${file.name}. Try saving it as CSV again.`);
    }
  }

  async function importRows() {
    if (!repo || count === 0) return;
    if (
      replace &&
      !window.confirm(
        `Replace all ${plural(menu.length, "item")} on the menu with these ${count}? Past orders keep theirs.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.importItems(result.items, replace);
      // What's left to fix stays in the box, under its header.
      const left = [result.header, ...toFix].filter((r) => r !== null);
      setText(
        toFix.length === 0
          ? ""
          : left.map((r) => text.slice(r.start, r.end)).join("\n") + "\n",
      );
      setReplace(false);
      setDone(
        `${replace ? "Replaced the menu with" : "Added"} ${plural(count, "item")}.` +
          (toFix.length ? ` ${plural(toFix.length, "row")} left to fix.` : ""),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The import didn't save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="import-items" className="border-highlight! p-4">
      <h3 className="text-lg">Import items</h3>
      <p className="text-muted mt-1 text-sm">
        Paste rows from a spreadsheet, or choose a CSV file. The columns are{" "}
        <span className="text-ink font-semibold">
          {MENU_COLUMNS.join(", ")}
        </span>
        , in that order or under a header row. Name, category and price are
        needed; prices in {symbol}
        {digits > 0 ? `, up to ${digits} decimals` : ", whole numbers"};
        available is yes or no.
      </p>

      <p
        role="status"
        className={cn(
          "text-sage-deep flex items-center gap-1.5 text-sm font-semibold",
          done ? "mt-2" : "sr-only",
        )}
      >
        {done ? (
          <>
            <Icon name="check" size={18} />
            {done}
          </>
        ) : null}
      </p>
      {error ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5">
        <label
          htmlFor="import-text"
          className="text-ink text-sm font-semibold tracking-wide"
        >
          Rows to import
        </label>
        <Textarea
          ref={box}
          id="import-text"
          rows={8}
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
          }}
          placeholder={`name,category,price\nCardamom Bun,Bakes,${digits > 0 ? `4.${"5".padEnd(digits, "0")}` : "450"}`}
          className="font-mono text-sm"
        />
        <label className="rounded-pill border-line bg-paper/70 font-round text-ink hover:border-primary focus-within:outline-ring inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 border-2 px-3.5 text-sm font-semibold focus-within:outline-3">
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(e) => void readFile(e.currentTarget)}
          />
          <Icon name="plus" size={18} />
          Choose a CSV file
        </label>
      </div>

      {result.rows.length > 0 ? (
        <section aria-labelledby="import-check" className="mt-4">
          <h4 id="import-check" className="text-base">
            Check before importing
          </h4>
          <p className="tnum text-muted text-sm">
            {plural(ready.length, "row")} ready
            {toFix.length ? ` · ${toFix.length} to fix` : ""}
          </p>

          {toFix.length ? (
            <ul aria-label="Rows to fix" className="mt-2 flex flex-col gap-2">
              {toFix.map((row) => (
                <li
                  key={row.row}
                  className="border-berry bg-paper flex flex-wrap items-start justify-between gap-2 rounded-md border-2 border-dashed p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-ink text-sm font-semibold">
                      Row {row.row}
                      {row.name ? ` · ${row.name}` : ""}
                    </p>
                    <ul className="text-berry-deep text-sm">
                      {row.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => fix(row)}
                    aria-label={`Fix row ${row.row}`}
                  >
                    <Icon name="edit" size={16} />
                    Fix
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {ready.length ? (
            <ul
              aria-label="Rows ready"
              className="border-line-soft divide-line-soft mt-2 max-h-72 divide-y overflow-y-auto rounded-md border-2"
            >
              {ready.map(({ row, item }) => (
                <li
                  key={row}
                  className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-ink font-semibold">{item!.name}</span>
                    <span className="text-muted"> · {item!.category}</span>
                    {item!.available ? null : (
                      <span className="text-muted"> · sold out</span>
                    )}
                  </span>
                  <span className="tnum text-primary shrink-0 font-semibold">
                    {formatMoney(item!.price, settings)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {menu.length > 0 && count > 0 ? (
        <fieldset className="mt-4 flex flex-col gap-1.5">
          <legend className="text-ink mb-1 text-sm font-semibold">
            The {plural(menu.length, "item")} on the menu now
          </legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={!replace}
              onChange={() => setReplace(false)}
              className="accent-primary size-5"
            />
            Keep them, and add these
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-mode"
              checked={replace}
              onChange={() => setReplace(true)}
              className="accent-primary size-5"
            />
            Replace them all with these
          </label>
        </fieldset>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => void importRows()}
          disabled={busy || count === 0}
          variant={replace ? "danger" : "primary"}
        >
          <Icon name="check" size={18} />
          {busy
            ? "Importing…"
            : replace
              ? `Replace the menu with ${plural(count, "item")}`
              : `Import ${plural(count, "item")}`}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {done ? "Done" : "Cancel"}
        </Button>
      </div>
    </Card>
  );
}

/** For an empty menu: one of the platform's starter menus, to edit. */
export function StarterMenuPicker({
  onPick,
}: {
  /** The starter menu as CSV, for the import to show and check. */
  onPick: (csv: string) => void;
}) {
  const { settings } = useCafeSettings();
  return (
    <Card className="p-4">
      <h3 className="text-lg">Add a starter menu</h3>
      <p className="text-muted mt-1 text-sm">
        A whole menu to edit rather than type. You&apos;ll see every item before
        anything is added, and can change any of them later.
        {hasStarterPrices(settings)
          ? " Prices are a starting point: set your own."
          : ` Prices are left empty for ${settings.currency}: fill them in before importing.`}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {STARTER_MENUS.map((menu) => (
          <li key={menu.id}>
            <button
              type="button"
              onClick={() => onPick(starterMenuCsv(menu.id, settings))}
              className="border-line bg-paper hover:border-primary focus-visible:outline-ring flex min-h-11 w-full flex-col rounded-md border-2 p-3 text-left transition-colors focus-visible:outline-3"
            >
              <span className="font-round text-ink font-semibold">
                {menu.name}
              </span>
              <span className="text-muted text-sm">
                {plural(menu.items.length, "item")} · {menu.blurb}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

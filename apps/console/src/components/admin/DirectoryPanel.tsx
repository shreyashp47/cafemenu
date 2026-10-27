"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import {
  FILTER_CHOICES,
  NO_FILTERS,
  directoryCsv,
  directorySummary,
  filterDirectory,
  type DirectoryFilters,
  type DirectoryRow,
} from "@/lib/admin/directory";
import { followOf, type HealthLevel } from "@/lib/admin/overview";
import { deploymentWhat } from "@/lib/admin/words";
import { Button, TextButton } from "../Button";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import { csvName, downloadCsv } from "./download";

const { cafes: card, directory: text, audit } = messages.admin;

const PILL: Record<HealthLevel, string> = {
  ok: "bg-brand-soft text-brand-ink",
  busy: "bg-accent-soft text-accent-ink",
  attention: "bg-danger-soft text-danger",
  paused: "bg-sunk text-ink",
  unknown: "bg-sunk text-ink",
  "not-live": "bg-sunk text-ink",
};

const pill = "rounded-pill inline-block px-3 py-1 text-sm font-semibold";

export function Fact({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-sm">{term}</dt>
      <dd className="text-text break-words">{children}</dd>
    </div>
  );
}

const when = (ms: number | null | undefined) =>
  typeof ms === "number" ? formatDateTime(ms) : text.notKnown;

/** A row's name: the cafe's, or the owner's email when they have none. */
export const rowName = (row: DirectoryRow) =>
  row.cafe?.settings.name ?? row.email;

export function maintenanceWords(row: DirectoryRow): string {
  const m = row.cafe?.maintenance;
  if (row.maintenance === "scheduled" && m?.startsAt) {
    return fill(text.maintenance.scheduled, {
      when: formatDateTime(m.startsAt),
    });
  }
  return text.maintenance[row.maintenance === "on" ? "on" : "off"];
}

function RowCard({
  row,
  selectable,
  selected,
  onSelect,
  onOpen,
}: {
  row: DirectoryRow;
  selectable: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
}) {
  const { cafe, owner, health, last, smoke } = row;
  const name = rowName(row);
  const follow = cafe ? followOf(cafe.release) : null;
  return (
    <article className="border-line bg-surface shadow-card h-full space-y-3 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-ink min-w-0 text-lg font-semibold break-words">
          {name}
        </h3>
        <p className="flex flex-wrap gap-2">
          {row.status === "suspended" && (
            <span className={`${pill} bg-danger-soft text-danger`}>
              {text.status.suspended}
            </span>
          )}
          {row.maintenance === "on" && (
            <span className={`${pill} bg-accent-soft text-accent-ink`}>
              {text.filters.maintenance.label}
            </span>
          )}
          {health && (
            <span className={`${pill} ${PILL[health.level]}`}>
              <span className="sr-only">{card.field.health}: </span>
              {card.health[health.level]}
            </span>
          )}
        </p>
      </div>
      {health && (
        <p className="text-muted text-sm">{card.reason[health.reason]}</p>
      )}
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Fact term={text.field.owner}>
          {owner?.name ? `${owner.name}, ${row.email}` : row.email}
        </Fact>
        <Fact term={text.field.account}>{text.status[row.status]}</Fact>
        <Fact term={text.field.signedUp}>
          {when(owner?.createdAt ?? cafe?.createdAt)}
        </Fact>
        <Fact term={text.field.lastSignIn}>
          {owner
            ? owner.lastSignInAt
              ? when(owner.lastSignInAt)
              : text.never
            : text.notKnown}
        </Fact>
        {cafe ? (
          <>
            <Fact term={card.field.site}>
              <code className="bg-sunk text-ink rounded-sm px-1.5 py-0.5 font-mono text-sm break-all">
                {cafe.site}.web.app
              </code>
            </Fact>
            <Fact term={text.field.project}>
              {cafe.projectId ?? card.version.none}
            </Fact>
            <Fact term={text.field.maintenance}>{maintenanceWords(row)}</Fact>
            <Fact term={text.field.plan}>
              {text.filters.plan[cafe.settings.plan] ?? cafe.settings.plan}
            </Fact>
            <Fact term={card.field.version}>
              {cafe.release.current ?? card.version.none}
            </Fact>
            <Fact term={card.field.follows}>
              {follow &&
                fill(card.follows[follow.kind], { line: follow.line ?? "" })}
            </Fact>
            <Fact term={card.field.last}>
              {last
                ? fill(card.last.text, {
                    what: deploymentWhat(last),
                    status: audit.status[last.status],
                    when: formatDateTime(last.createdAt),
                  })
                : card.last.none}
            </Fact>
            <Fact term={card.field.smoke}>
              {smoke
                ? fill(card.smokeAt, {
                    result: card.smokeResult[smoke.result],
                    when: formatDateTime(smoke.at),
                  })
                : card.smokeResult.none}
            </Fact>
          </>
        ) : (
          <Fact term={card.field.site}>{text.noCafe}</Fact>
        )}
      </dl>
      {cafe && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button
            variant="secondary"
            onClick={onOpen}
            aria-label={fill(text.openLabel, { name })}
          >
            {text.open}
          </Button>
          {selectable && (
            <label className="min-h-tap text-ink inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => onSelect(e.target.checked)}
                aria-label={fill(text.selectLabel, { name })}
                className="size-5"
              />
              <span aria-hidden="true">{text.select}</span>
            </label>
          )}
        </div>
      )}
    </article>
  );
}

function FilterSelect<K extends keyof DirectoryFilters>({
  name,
  value,
  onChange,
}: {
  name: K;
  value: DirectoryFilters[K];
  onChange: (value: DirectoryFilters[K]) => void;
}) {
  const words = text.filters[name] as Record<string, string>;
  const id = `directory-filter-${name}`;
  return (
    <Field id={id} label={words.label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DirectoryFilters[K])}
        {...controlProps(id, {})}
        className={`${controlClass} min-h-tap`}
      >
        {FILTER_CHOICES[name].map((choice) => (
          <option key={choice} value={choice}>
            {words[choice] ?? choice}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Every owner and cafe (#78, section 3.1): who owns it and when they signed
 * up and last signed in, the cafe's address and project, its status,
 * maintenance, plan, release and how it is doing. Search, five filters, a
 * CSV of what is shown, and each cafe's full history and actions behind
 * Open. Cards, so a phone has no table to scroll.
 */
export function DirectoryPanel({
  rows,
  state,
  ownersFailed,
  canAct,
  selected,
  onSelect,
  onClearSelection,
  onBulk,
  onOpen,
}: {
  rows: DirectoryRow[];
  state: "loading" | "error" | "ready";
  ownersFailed: boolean;
  canAct: boolean;
  selected: ReadonlySet<string>;
  onSelect: (cafeId: string, on: boolean) => void;
  onClearSelection: () => void;
  onBulk: () => void;
  onOpen: (cafeId: string) => void;
}) {
  const [filters, setFilters] = useState<DirectoryFilters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => filterDirectory(rows, filters, query),
    [rows, filters, query],
  );
  const counts = directorySummary(rows);
  const filtered = Object.values(filters).some((v) => v !== "all");

  return (
    <FormSection id="admin-cafes" title={text.title}>
      {state === "loading" && (
        <p role="status" className="text-muted">
          {card.loading}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-danger font-medium">
          {card.error}
        </p>
      )}
      {state === "ready" && (
        <>
          <p className="text-text">{fill(text.summary, { ...counts })}</p>
          <p className="text-muted text-sm">
            {ownersFailed ? text.ownersError : text.ownersLag}
          </p>
          <div className="space-y-4">
            <Field
              id="admin-search"
              label={text.search.label}
              hint={text.search.hint}
            >
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                {...controlProps("admin-search", { hint: text.search.hint })}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
            <fieldset>
              <legend className="text-ink font-semibold">
                {text.filters.label}
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {(Object.keys(NO_FILTERS) as (keyof DirectoryFilters)[]).map(
                  (name) => (
                    <FilterSelect
                      key={name}
                      name={name}
                      value={filters[name]}
                      onChange={(value) =>
                        setFilters((f) => ({ ...f, [name]: value }))
                      }
                    />
                  ),
                )}
              </div>
              {filtered && (
                <TextButton onClick={() => setFilters(NO_FILTERS)}>
                  {text.filters.clear}
                </TextButton>
              )}
            </fieldset>
          </div>
          {rows.length === 0 && <p className="text-muted">{text.none}</p>}
          {rows.length > 0 && shown.length === 0 && (
            <p role="status" className="text-muted">
              {text.noMatch}
            </p>
          )}
          {shown.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-muted text-sm">
                  {fill(text.count, {
                    shown: shown.length,
                    total: rows.length,
                  })}
                </p>
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadCsv(
                      csvName("owners-and-cafes", Date.now()),
                      directoryCsv(shown),
                    )
                  }
                >
                  {fill(text.export, { count: shown.length })}
                </Button>
              </div>
              {selected.size > 0 && (
                <div className="border-line bg-sunk flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border p-3">
                  <p role="status" className="text-ink font-semibold">
                    {selected.size === 1
                      ? text.selected.one
                      : fill(text.selected.other, { count: selected.size })}
                  </p>
                  <Button onClick={onBulk}>{text.bulk}</Button>
                  <TextButton onClick={onClearSelection}>
                    {text.clearSelection}
                  </TextButton>
                </div>
              )}
              <ul className="grid gap-4 lg:grid-cols-2">
                {shown.map((row) => (
                  <li key={row.key}>
                    <RowCard
                      row={row}
                      selectable={
                        canAct &&
                        row.cafe !== null &&
                        row.cafe.projectId !== null &&
                        row.cafe.status !== "draft"
                      }
                      selected={row.cafe ? selected.has(row.cafe.id) : false}
                      onSelect={(on) => row.cafe && onSelect(row.cafe.id, on)}
                      onOpen={() => row.cafe && onOpen(row.cafe.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </FormSection>
  );
}

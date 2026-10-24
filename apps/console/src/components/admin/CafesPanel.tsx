"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import {
  ADMIN_FILTERS,
  filterRows,
  followOf,
  summary,
  type AdminFilter,
  type AdminRow,
  type HealthLevel,
} from "@/lib/admin/overview";
import { deploymentWhat } from "@/lib/admin/words";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";

const { cafes: text, audit } = messages.admin;

const PILL: Record<HealthLevel, string> = {
  ok: "bg-brand-soft text-brand-ink",
  busy: "bg-accent-soft text-accent-ink",
  attention: "bg-danger-soft text-danger",
  paused: "bg-sunk text-ink",
  unknown: "bg-sunk text-ink",
  "not-live": "bg-sunk text-ink",
};

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-sm">{term}</dt>
      <dd className="text-text break-words">{children}</dd>
    </div>
  );
}

function CafeCard({ row }: { row: AdminRow }) {
  const { cafe, health, last, smoke } = row;
  const follow = followOf(cafe.release);
  const { current, previous } = cafe.release;
  return (
    <article className="border-line bg-surface shadow-card h-full space-y-3 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-ink min-w-0 text-lg font-semibold break-words">
          {cafe.settings.name}
        </h3>
        <p>
          <span className="sr-only">{text.field.health}: </span>
          <span
            className={`rounded-pill inline-block px-3 py-1 text-sm font-semibold ${PILL[health.level]}`}
          >
            {text.health[health.level]}
          </span>
        </p>
      </div>
      <p className="text-muted text-sm">{text.reason[health.reason]}</p>
      {health.error && (
        <p className="bg-danger-soft text-danger rounded-md p-3 text-sm">
          {fill(text.error, { error: health.error })}
        </p>
      )}
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Fact term={text.field.version}>
          {current ?? text.version.none}
          {previous && (
            <span className="text-muted">
              {" "}
              {fill(text.version.previous, { version: previous })}
            </span>
          )}
        </Fact>
        <Fact term={text.field.follows}>
          {fill(text.follows[follow.kind], { line: follow.line ?? "" })}
        </Fact>
        <Fact term={text.field.last}>
          {last
            ? fill(text.last.text, {
                what: deploymentWhat(last),
                status: audit.status[last.status],
                when: formatDateTime(last.createdAt),
              })
            : text.last.none}
        </Fact>
        <Fact term={text.field.smoke}>
          {smoke
            ? fill(text.smokeAt, {
                result: text.smokeResult[smoke.result],
                when: formatDateTime(smoke.at),
              })
            : text.smokeResult.none}
        </Fact>
        <Fact term={text.field.owner}>{cafe.ownerEmail}</Fact>
        <Fact term={text.field.site}>
          <code className="bg-sunk text-ink rounded-sm px-1.5 py-0.5 font-mono text-sm break-all">
            {cafe.site}.web.app
          </code>
        </Fact>
      </dl>
    </article>
  );
}

/**
 * Every cafe: how it is doing, from its latest deployment and the smoke test
 * in it, which release it is on and how it follows releases, who owns it.
 * Cards, so a phone has no table to scroll.
 */
export function CafesPanel({
  rows,
  state,
}: {
  rows: AdminRow[];
  state: "loading" | "error" | "ready";
}) {
  const [filter, setFilter] = useState<AdminFilter>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => filterRows(rows, filter, query),
    [rows, filter, query],
  );
  const counts = summary(rows);

  return (
    <FormSection id="admin-cafes" title={text.title}>
      {state === "loading" && (
        <p role="status" className="text-muted">
          {text.loading}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-danger font-medium">
          {text.error}
        </p>
      )}
      {state === "ready" && (
        <>
          <p className="text-text">{fill(text.summary, { ...counts })}</p>
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
            <div role="group" aria-labelledby="admin-filter-label">
              <p id="admin-filter-label" className="text-ink font-semibold">
                {text.filter.label}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ADMIN_FILTERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className="rounded-pill border-line-field min-h-tap aria-pressed:border-brand aria-pressed:bg-brand aria-pressed:text-surface text-ink border px-4 text-sm font-semibold"
                  >
                    {text.filter[id]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {rows.length === 0 && <p className="text-muted">{text.none}</p>}
          {rows.length > 0 && shown.length === 0 && (
            <p role="status" className="text-muted">
              {text.noMatch}
            </p>
          )}
          {shown.length > 0 && (
            <>
              <p role="status" className="text-muted text-sm">
                {fill(text.count, { shown: shown.length, total: rows.length })}
              </p>
              <ul className="grid gap-4 lg:grid-cols-2">
                {shown.map((row) => (
                  <li key={row.cafe.id}>
                    <CafeCard row={row} />
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

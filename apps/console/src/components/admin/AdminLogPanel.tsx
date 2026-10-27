"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import {
  LOG_ACTIONS,
  filterLog,
  logCafeName,
  logCsv,
  logOwnerEmail,
  type LogAction,
  type LogLookups,
} from "@/lib/admin/log";
import type { AdminLogEntry } from "@/lib/platform/model";
import { Button } from "../Button";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import { reasonText } from "./CafeDetail";
import { csvName, downloadCsv } from "./download";

const { log: text, words, cafe } = messages.admin;

const actionWords = words.actions as Record<string, string>;

/**
 * The admin log (#78, section 3.3): every admin action as the backend did
 * it, newest first, filtered by action or by what it is about, and exported
 * as CSV. Read-only, here and in the rules: nobody edits or deletes an entry.
 */
export function AdminLogPanel({
  entries,
  state,
  error,
  limit,
  lookups,
}: {
  entries: AdminLogEntry[];
  state: "loading" | "error" | "ready";
  error: string | null;
  limit: number;
  lookups: LogLookups;
}) {
  const [action, setAction] = useState<LogAction>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => filterLog(entries, { action, query }, lookups),
    [entries, action, query, lookups],
  );

  return (
    <FormSection id="admin-log" title={text.title}>
      <p className="text-text">{text.explain}</p>
      {state === "loading" && (
        <p role="status" className="text-muted">
          {text.loading}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-danger font-medium">
          {fill(text.error, { error: error ?? "" })}
        </p>
      )}
      {state === "ready" && entries.length === 0 && (
        <p className="text-muted">{text.none}</p>
      )}
      {state === "ready" && entries.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="admin-log-action" label={text.action.label}>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as LogAction)}
                {...controlProps("admin-log-action", {})}
                className={`${controlClass} min-h-tap`}
              >
                {LOG_ACTIONS.map((id) => (
                  <option key={id} value={id}>
                    {id === "all" ? text.action.all : actionWords[id]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="admin-log-search"
              label={text.search.label}
              hint={text.search.hint}
            >
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                {...controlProps("admin-log-search", {
                  hint: text.search.hint,
                })}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-muted text-sm">
              {shown.length === 0
                ? text.noMatch
                : fill(text.count, {
                    shown: shown.length,
                    total: Math.min(entries.length, limit),
                  })}
            </p>
            {shown.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    csvName("admin-log", Date.now()),
                    logCsv(shown, lookups),
                  )
                }
              >
                {fill(text.export, { count: shown.length })}
              </Button>
            )}
          </div>
          <ol className="divide-line divide-y">
            {shown.map((entry) => {
              const reason = reasonText(entry.reason);
              const owner = logOwnerEmail(entry, lookups);
              return (
                <li key={entry.id} className="space-y-0.5 py-3">
                  <p className="text-ink font-semibold">
                    {fill(text.entry, {
                      action: actionWords[entry.action] ?? entry.action,
                      cafe: logCafeName(entry, lookups) || "—",
                    })}
                  </p>
                  <p className="text-muted text-sm">
                    {fill(text.by, {
                      who: entry.byEmail ?? entry.by,
                      when: formatDateTime(entry.at),
                    })}
                  </p>
                  {owner && (
                    <p className="text-text text-sm">
                      {fill(text.owner, { email: owner })}
                    </p>
                  )}
                  {reason && (
                    <p className="text-text text-sm">
                      {fill(cafe.reason, { reason })}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </FormSection>
  );
}

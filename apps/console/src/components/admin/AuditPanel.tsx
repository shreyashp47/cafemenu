"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import { auditRows, smokeOf } from "@/lib/admin/overview";
import { deploymentWhat, whoText } from "@/lib/admin/words";
import type { Cafe, Deployment } from "@/lib/platform/model";
import { Button } from "../Button";
import { FormSection, controlClass, controlProps } from "../form/Field";

const { audit: text, cafes } = messages.admin;

const PAGE = 25;

/**
 * Every deployment of every cafe, newest first: who asked, what, when and
 * how it went, with the smoke test and the error when there is one.
 */
export function AuditPanel({
  cafes: list,
  deployments,
  limit,
  state,
}: {
  cafes: readonly Cafe[];
  deployments: readonly Deployment[];
  /** How many the page loaded at most. */
  limit: number;
  state: "loading" | "error" | "ready";
}) {
  const [cafeId, setCafeId] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(
    () => auditRows(deployments, list, { cafeId, problemsOnly }),
    [deployments, list, cafeId, problemsOnly],
  );
  const named = useMemo(
    () =>
      [...list].sort((a, b) =>
        a.settings.name.localeCompare(b.settings.name, "en"),
      ),
    [list],
  );

  return (
    <FormSection id="admin-audit" title={text.title}>
      <p className="text-text">{fill(text.lead, { limit })}</p>
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
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="w-full sm:w-72">
              <label
                htmlFor="audit-cafe"
                className="text-ink block font-semibold"
              >
                {text.filter.cafe}
              </label>
              <select
                value={cafeId ?? ""}
                onChange={(e) => {
                  setCafeId(e.target.value || null);
                  setShown(PAGE);
                }}
                {...controlProps("audit-cafe", {})}
                className={`${controlClass} min-h-tap mt-2`}
              >
                <option value="">{text.filter.all}</option>
                {named.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.settings.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="min-h-tap flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={problemsOnly}
                onChange={(e) => {
                  setProblemsOnly(e.target.checked);
                  setShown(PAGE);
                }}
                className="accent-brand h-5 w-5"
              />
              <span>{text.filter.problems}</span>
            </label>
          </div>

          {rows.length === 0 && <p className="text-muted">{text.none}</p>}
          {rows.length > 0 && (
            <>
              <p role="status" className="text-muted text-sm">
                {fill(text.count, {
                  shown: Math.min(shown, rows.length),
                  total: rows.length,
                })}
              </p>
              <ol className="divide-line divide-y">
                {rows
                  .slice(0, shown)
                  .map(({ deployment: d, cafeName, who }) => {
                    const smoke = smokeOf(d);
                    const bad =
                      d.status === "failed" || d.status === "rolled-back";
                    return (
                      <li key={d.id} className="space-y-1 py-3">
                        <p className="text-ink font-semibold break-words">
                          {deploymentWhat(d)}
                          <span className="text-muted font-normal">
                            {" · "}
                            {cafeName}
                          </span>
                        </p>
                        <p className="text-text">
                          <span
                            className={bad ? "text-danger font-semibold" : ""}
                          >
                            {text.status[d.status]}
                          </span>
                          <span className="text-muted">
                            {" · "}
                            {whoText(who)}
                            {" · "}
                            <time
                              dateTime={new Date(d.createdAt).toISOString()}
                            >
                              {formatDateTime(d.createdAt)}
                            </time>
                          </span>
                        </p>
                        {smoke && (
                          <p className="text-muted text-sm">
                            {fill(text.smoke, {
                              result: cafes.smokeResult[smoke],
                            })}
                          </p>
                        )}
                        {d.error && (
                          <p className="bg-danger-soft text-danger rounded-md p-3 text-sm">
                            {fill(text.error, { error: d.error })}
                          </p>
                        )}
                      </li>
                    );
                  })}
              </ol>
              {rows.length > shown && (
                <Button
                  variant="secondary"
                  onClick={() => setShown((n) => n + PAGE)}
                >
                  {text.more}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </FormSection>
  );
}

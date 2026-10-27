"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { errorText, fill, messages } from "@/lib/messages";
import type { DirectoryRow } from "@/lib/admin/directory";
import {
  HISTORY_FILTERS,
  historyItems,
  maintenanceWindows,
  type HistoryFilter,
  type HistoryItem,
} from "@/lib/admin/history";
import { deploymentWhat } from "@/lib/admin/words";
import type { CafeHistory, DataBundle } from "@/lib/data/types";
import type { AdminReason } from "@/lib/platform/model";
import { TextButton } from "../Button";
import { AdminActions } from "./AdminActions";
import { Fact, maintenanceWords, rowName } from "./DirectoryPanel";

const { cafe: text, directory, words, audit, cafes: card } = messages.admin;

const lookup = (table: Record<string, string>, key: string) =>
  table[key] ?? key;

export function reasonText(reason: AdminReason | null): string | null {
  if (!reason || (!reason.code && !reason.note)) return null;
  const label = reason.code ? lookup(words.reasons, reason.code) : "";
  return [label, reason.note].filter(Boolean).join(": ");
}

function ItemText({ item }: { item: HistoryItem }) {
  switch (item.kind) {
    case "request": {
      const { request } = item;
      return (
        <>
          {fill(text.history.request, {
            kind: lookup(words.requests, request.kind),
            status: words.requestStatus[request.status],
          })}
          {request.status === "queued" && request.notBefore && (
            <span className="text-muted block text-sm">
              {fill(text.history.scheduled, {
                when: formatDateTime(request.notBefore),
              })}
            </span>
          )}
          {request.error && (
            <span className="text-danger block text-sm">{request.error}</span>
          )}
        </>
      );
    }
    case "deployment":
      return (
        <>
          {fill(text.history.deployment, {
            what: deploymentWhat(item.deployment),
            status: audit.status[item.deployment.status],
          })}
          {item.deployment.error && (
            <span className="text-danger block text-sm">
              {item.deployment.error}
            </span>
          )}
        </>
      );
    case "admin": {
      const reason = reasonText(item.entry.reason);
      return (
        <>
          {fill(text.history.admin, {
            action: lookup(words.actions, item.entry.action),
            who: item.entry.byEmail ?? item.entry.by,
          })}
          {reason && (
            <span className="text-muted block text-sm">
              {fill(text.reason, { reason })}
            </span>
          )}
        </>
      );
    }
    case "email":
      return (
        <>
          {fill(text.history.email, {
            kind: lookup(words.emails, item.email.kind),
          })}
        </>
      );
  }
}

/**
 * One cafe, opened from the directory (#78): what it is, its owner's status
 * and why, CafeMenu's maintenance of it, the actions, and its full history,
 * live: requests, deployments, status changes, maintenance windows and the
 * emails its owner was sent.
 */
export function CafeDetail({
  data,
  row,
  onBack,
}: {
  data: DataBundle;
  row: DirectoryRow;
  onBack: () => void;
}) {
  const cafe = row.cafe;
  const cafeId = cafe?.id ?? "";
  const [history, setHistory] = useState<CafeHistory | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), [cafeId]);
  useEffect(() => {
    if (!cafeId) return;
    setHistory(null);
    setFailure(null);
    return data.directory.subscribeHistory(cafeId, setHistory, (error) =>
      setFailure(errorText(error)),
    );
  }, [data, cafeId]);

  const items = useMemo(
    () => (history ? historyItems(history, filter) : []),
    [history, filter],
  );
  const windows = useMemo(
    () => (history ? maintenanceWindows(history.log) : []),
    [history],
  );

  if (!cafe) {
    return (
      <div className="border-line bg-surface shadow-card space-y-4 rounded-xl border p-5 sm:p-8">
        <p role="alert">{text.notFound}</p>
        <TextButton onClick={onBack}>{text.back}</TextButton>
      </div>
    );
  }

  const statusReason = reasonText(cafe.statusReason ?? null);
  const m = cafe.maintenance;
  return (
    <section
      aria-labelledby="admin-cafe-title"
      className="border-line bg-surface shadow-card space-y-6 rounded-xl border p-5 sm:p-8"
    >
      <TextButton onClick={onBack}>{text.back}</TextButton>
      <div>
        <p className="text-muted text-sm font-semibold tracking-wide uppercase">
          {text.eyebrow}
        </p>
        <h2
          id="admin-cafe-title"
          ref={heading}
          tabIndex={-1}
          className="text-ink text-2xl font-semibold break-words"
        >
          {rowName(row)}
        </h2>
      </div>

      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Fact term={directory.field.owner}>
          {row.owner?.name ? `${row.owner.name}, ${row.email}` : row.email}
        </Fact>
        <Fact term={directory.field.account}>
          {cafe.statusChangedAt
            ? fill(text.statusSince, {
                status: directory.status[row.status],
                when: formatDateTime(cafe.statusChangedAt),
              })
            : directory.status[row.status]}
        </Fact>
        <Fact term={card.field.site}>
          <code className="bg-sunk text-ink rounded-sm px-1.5 py-0.5 font-mono text-sm break-all">
            {cafe.site}.web.app
          </code>
        </Fact>
        <Fact term={directory.field.project}>
          {cafe.projectId ?? card.version.none}
        </Fact>
        <Fact term={directory.field.maintenance}>{maintenanceWords(row)}</Fact>
        <Fact term={card.field.version}>
          {cafe.release.current ?? card.version.none}
        </Fact>
      </dl>
      {statusReason && (
        <p className="text-text">
          {fill(text.reason, { reason: statusReason })}
        </p>
      )}
      {m && row.maintenance !== "off" && (
        <div className="bg-accent-soft text-ink space-y-1 rounded-md p-3">
          <p className="font-semibold">
            {row.maintenance === "on"
              ? fill(text.maintenance.on, {
                  when: formatDateTime(m.startsAt ?? m.setAt ?? Date.now()),
                })
              : fill(text.maintenance.scheduled, {
                  when: formatDateTime(m.startsAt ?? Date.now()),
                })}{" "}
            {m.endsAt !== null &&
              fill(text.maintenance.ends, { when: formatDateTime(m.endsAt) })}
          </p>
          {reasonText(m.reason) && (
            <p>{fill(text.reason, { reason: reasonText(m.reason) ?? "" })}</p>
          )}
          {m.message && (
            <p>{fill(text.maintenance.message, { message: m.message })}</p>
          )}
        </div>
      )}

      <AdminActions
        key={cafe.id}
        data={data}
        row={row}
        ownerIsAdmin={row.owner?.admin === true}
        suspensionWaiting={
          history?.requests.some(
            (r) => r.kind === "suspend" && r.status === "queued",
          ) ?? false
        }
      />

      <section aria-labelledby="admin-history-title" className="space-y-4">
        <h3 id="admin-history-title" className="text-ink text-lg font-semibold">
          {text.history.title}
        </h3>
        <div role="group" aria-labelledby="admin-history-filter">
          <p id="admin-history-filter" className="text-ink font-semibold">
            {text.history.filter.label}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {HISTORY_FILTERS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className="rounded-pill border-line-field min-h-tap aria-pressed:border-brand aria-pressed:bg-brand aria-pressed:text-surface text-ink border px-4 text-sm font-semibold"
              >
                {text.history.filter[id]}
              </button>
            ))}
          </div>
        </div>
        {failure && (
          <p role="alert" className="text-danger font-medium">
            {fill(text.history.error, { error: failure })}
          </p>
        )}
        {!history && !failure && (
          <p role="status" className="text-muted">
            {text.history.loading}
          </p>
        )}
        {history && filter === "maintenance" && windows.length > 0 && (
          <div>
            <h4 className="text-ink font-semibold">
              {text.history.windows.title}
            </h4>
            <ul className="text-text list-disc pl-5">
              {windows.map((w) => (
                <li key={w.on.id}>
                  {w.to === null
                    ? fill(text.history.windows.open, {
                        from: formatDateTime(w.from),
                      })
                    : fill(text.history.windows.closed, {
                        from: formatDateTime(w.from),
                        to: formatDateTime(w.to),
                      })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {history && items.length === 0 && (
          <p className="text-muted">{text.history.none}</p>
        )}
        {items.length > 0 && (
          <ol className="divide-line divide-y">
            {items.map((item) => (
              <li
                key={`${item.kind}-${
                  item.kind === "request"
                    ? item.request.id
                    : item.kind === "deployment"
                      ? item.deployment.id
                      : item.kind === "admin"
                        ? item.entry.id
                        : item.email.id
                }`}
                className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4"
              >
                <time
                  dateTime={new Date(item.at).toISOString()}
                  className="text-muted shrink-0 text-sm sm:w-44"
                >
                  {formatDateTime(item.at)}
                </time>
                <span className="text-text min-w-0 break-words">
                  <ItemText item={item} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

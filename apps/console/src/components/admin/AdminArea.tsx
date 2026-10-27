"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useDataBundle } from "@/lib/data/hooks";
import type { DataBundle } from "@/lib/data/types";
import { errorText, fill, messages } from "@/lib/messages";
import { directoryRows } from "@/lib/admin/directory";
import type {
  AdminLogEntry,
  Cafe,
  Deployment,
  OwnerRecord,
  PlatformUser,
} from "@/lib/platform/model";
import { DemoNotice } from "../DemoNotice";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { TextButton } from "../Button";
import { SignInForm } from "../setup/SignInForm";
import { Card } from "../setup/Card";
import { AdminLogPanel } from "./AdminLogPanel";
import { AdminsPanel } from "./AdminsPanel";
import { AuditPanel } from "./AuditPanel";
import { BulkMaintenance } from "./BulkMaintenance";
import { CafeDetail } from "./CafeDetail";
import { DirectoryPanel } from "./DirectoryPanel";
import { ReleasesPanel } from "./ReleasesPanel";

const { admin: text } = messages;

/** How many deployments the page loads: the audit log, and each cafe's last. */
export const AUDIT_LIMIT = 200;

/**
 * The platform admin (#30) and super admin (#78): every owner and cafe and
 * how each is doing, one cafe's history and the actions on it (suspend,
 * reactivate, delete, maintenance, one cafe or several), the admin log, the
 * admins, the releases, and the deployments. Only for an account with the
 * `admin` claim; the rules refuse everyone else these reads, so this is a
 * courtesy, not the lock. Every change is a request the backend does and
 * logs; there is no way to be an owner or see an order.
 */
export function AdminArea() {
  const data = useDataBundle();
  const { ready, user } = useAccount(data);

  let body: React.ReactNode;
  if (!data || !ready) {
    body = (
      <p role="status" className="text-muted">
        {text.loading}
      </p>
    );
  } else if (!user) {
    body = (
      <SignInForm
        data={data}
        title={text.signIn.title}
        lead={text.signIn.text}
      />
    );
  } else if (!user.isAdmin) {
    body = (
      <Card>
        <StageHeading title={text.notAdmin.title} focus={false} />
        <p className="text-text">
          <Rich text={fill(text.notAdmin.text, { email: user.email })} />
        </p>
        <TextButton onClick={() => void data.auth.signOut()}>
          {text.notAdmin.signOut}
        </TextButton>
      </Card>
    );
  } else {
    body = <Console data={data} user={user} />;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
      {data?.backend === "demo" && <DemoNotice text={text.demo} />}
      {body}
    </div>
  );
}

type Load<T> = { state: "loading" | "error" | "ready"; value: T };

/** How many admin log entries the page reads. */
export const LOG_LIMIT = 500;

function Console({ data, user }: { data: DataBundle; user: PlatformUser }) {
  const [cafes, setCafes] = useState<Load<Cafe[]>>({
    state: "loading",
    value: [],
  });
  const [deployments, setDeployments] = useState<Load<Deployment[]>>({
    state: "loading",
    value: [],
  });
  const [owners, setOwners] = useState<Load<OwnerRecord[]>>({
    state: "loading",
    value: [],
  });
  const [log, setLog] = useState<Load<AdminLogEntry[]>>({
    state: "loading",
    value: [],
  });
  const [logError, setLogError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(
    () =>
      data.cafes.subscribeAll(
        (value) => setCafes({ state: "ready", value }),
        () => setCafes({ state: "error", value: [] }),
      ),
    [data],
  );
  useEffect(
    () =>
      data.deployments.subscribeRecent(
        AUDIT_LIMIT,
        (value) => setDeployments({ state: "ready", value }),
        () => setDeployments({ state: "error", value: [] }),
      ),
    [data],
  );
  useEffect(
    () =>
      data.directory.subscribeOwners(
        (value) => setOwners({ state: "ready", value }),
        () => setOwners({ state: "error", value: [] }),
      ),
    [data],
  );
  useEffect(
    () =>
      data.directory.subscribeLog(
        LOG_LIMIT,
        (value) => setLog({ state: "ready", value }),
        (error) => {
          setLogError(errorText(error));
          setLog({ state: "error", value: [] });
        },
      ),
    [data],
  );

  const rows = useMemo(
    () =>
      directoryRows(cafes.value, owners.value, deployments.value, Date.now()),
    [cafes.value, owners.value, deployments.value],
  );
  const lookups = useMemo(
    () => ({
      cafes: new Map(cafes.value.map((c) => [c.id, c])),
      owners: new Map(owners.value.map((o) => [o.uid, o])),
    }),
    [cafes.value, owners.value],
  );
  const cafesState =
    cafes.state === "error"
      ? "error"
      : cafes.state === "ready" &&
          deployments.state !== "loading" &&
          owners.state !== "loading"
        ? "ready"
        : "loading";
  const openRow = opened ? rows.find((r) => r.cafe?.id === opened) : undefined;
  // Only cafes still in the list stay selected.
  const selectedIds = [...selected].filter((id) => lookups.cafes.has(id));

  return (
    <>
      <div className="border-line bg-surface shadow-card space-y-4 rounded-xl border p-5 sm:p-8">
        <StageHeading eyebrow={text.eyebrow} title={text.title} focus={false} />
        <p className="text-text">{text.lead}</p>
        <nav aria-label={text.nav.label}>
          <ul className="flex flex-wrap gap-x-5">
            {(
              [
                ["cafes", "admin-cafes"],
                ["log", "admin-log"],
                ["admins", "admin-admins"],
                ["releases", "admin-releases"],
                ["audit", "admin-audit"],
              ] as const
            ).map(([key, id]) => (
              <li key={key}>
                <a
                  href={`#${id}-title`}
                  onClick={() => setOpened(null)}
                  className="text-brand-ink min-h-tap inline-flex items-center font-medium underline underline-offset-4"
                >
                  {text.nav[key]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-muted flex flex-wrap items-center gap-x-3 text-sm">
          <span>
            <Rich text={fill(text.account.signedIn, { email: user.email })} />
          </span>
          <TextButton onClick={() => void data.auth.signOut()}>
            {text.account.signOut}
          </TextButton>
        </p>
      </div>
      {opened ? (
        <CafeDetail
          data={data}
          row={
            openRow ?? {
              key: opened,
              cafe: null,
              owner: null,
              ownerUid: "",
              email: "",
              status: "active",
              health: null,
              last: null,
              smoke: null,
              maintenance: "off",
            }
          }
          onBack={() => setOpened(null)}
        />
      ) : (
        <>
          <BulkMaintenance
            data={data}
            cafes={lookups.cafes}
            selected={selectedIds}
            open={bulkOpen}
            onClose={() => {
              setBulkOpen(false);
              setSelected(new Set());
            }}
          />
          <DirectoryPanel
            rows={rows}
            state={cafesState}
            ownersFailed={owners.state === "error"}
            canAct={data.directory.canAct}
            selected={new Set(selectedIds)}
            onSelect={(id, on) =>
              setSelected((was) => {
                const next = new Set(was);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onClearSelection={() => {
              setSelected(new Set());
              setBulkOpen(false);
            }}
            onBulk={() => {
              setBulkOpen(true);
              document
                .getElementById("admin-bulk-title")
                ?.scrollIntoView?.({ block: "start" });
            }}
            onOpen={setOpened}
          />
        </>
      )}
      <AdminLogPanel
        entries={log.value}
        state={log.state}
        error={logError}
        limit={LOG_LIMIT}
        lookups={lookups}
      />
      <AdminsPanel data={data} user={user} owners={owners.value} />
      <ReleasesPanel data={data} />
      <AuditPanel
        cafes={cafes.value}
        deployments={deployments.value}
        limit={AUDIT_LIMIT}
        state={
          deployments.state === "ready" && cafes.state !== "loading"
            ? "ready"
            : deployments.state === "error"
              ? "error"
              : "loading"
        }
      />
    </>
  );
}

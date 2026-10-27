"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useDataBundle } from "@/lib/data/hooks";
import type { DataBundle } from "@/lib/data/types";
import { fill, messages } from "@/lib/messages";
import { adminRows } from "@/lib/admin/overview";
import type { Cafe, Deployment, PlatformUser } from "@/lib/platform/model";
import { DemoNotice } from "../DemoNotice";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { TextButton } from "../Button";
import { SignInForm } from "../setup/SignInForm";
import { Card } from "../setup/Card";
import { AuditPanel } from "./AuditPanel";
import { CafesPanel } from "./CafesPanel";
import { ReleasesPanel } from "./ReleasesPanel";

const { admin: text } = messages;

/** How many deployments the page loads: the audit log, and each cafe's last. */
export const AUDIT_LIMIT = 200;

/**
 * The platform admin (#30): every cafe and how it is doing, the releases, and
 * an audit log of deployments. Only for an account with the `admin` claim;
 * the rules refuse everyone else these reads, so this is a courtesy, not the
 * lock. Read-only for cafes, and no way to be an owner or see an order.
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

function Console({ data, user }: { data: DataBundle; user: PlatformUser }) {
  const [cafes, setCafes] = useState<Load<Cafe[]>>({
    state: "loading",
    value: [],
  });
  const [deployments, setDeployments] = useState<Load<Deployment[]>>({
    state: "loading",
    value: [],
  });

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

  const rows = useMemo(
    () => adminRows(cafes.value, deployments.value),
    [cafes.value, deployments.value],
  );
  const cafesState =
    cafes.state === "error"
      ? "error"
      : cafes.state === "ready" && deployments.state !== "loading"
        ? "ready"
        : "loading";

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
                ["releases", "admin-releases"],
                ["audit", "admin-audit"],
              ] as const
            ).map(([key, id]) => (
              <li key={key}>
                <a
                  href={`#${id}-title`}
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
      <CafesPanel rows={rows} state={cafesState} />
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

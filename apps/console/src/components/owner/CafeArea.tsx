"use client";

import { useEffect, useState } from "react";
import { demoGoLive } from "@/lib/data/demo";
import { useAccount, useDataBundle } from "@/lib/data/hooks";
import type { DataBundle } from "@/lib/data/types";
import { fill, messages } from "@/lib/messages";
import { cafeToShow } from "@/lib/owner/area";
import { requestToShow } from "@/lib/owner/requests";
import type { BackendRequest, Cafe, Deployment } from "@/lib/platform/model";
import { Button } from "../Button";
import { DemoNotice } from "../DemoNotice";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { SignInForm } from "../setup/SignInForm";
import { Card } from "../setup/Card";
import { AccessPanel } from "./AccessPanel";
import { BrandingPanel } from "./BrandingPanel";
import { CafeHeader } from "./CafeHeader";
import { RequestStatus } from "./RequestStatus";
import { UpdatesPanel } from "./UpdatesPanel";

const { cafe: text } = messages;

/**
 * The owner area (#29): for a signed-in owner's cafe, its updates, its
 * branding and what CafeMenu can do in its project. The cafe is the one in
 * the address (`?cafe=`), else the owner's oldest that is past setup.
 */
export function CafeArea() {
  const data = useDataBundle();
  const { ready, user } = useAccount(data);
  const [cafes, setCafes] = useState<Cafe[] | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setWanted(new URLSearchParams(window.location.search).get("cafe"));
  }, []);

  const uid = user?.uid ?? null;
  useEffect(() => {
    setCafes(null);
    setFailed(false);
    if (!data || !uid) return;
    return data.cafes.subscribeMine(uid, setCafes, () => {
      setFailed(true);
      setCafes([]);
    });
  }, [data, uid]);

  let body: React.ReactNode;
  if (!data || !ready || (user && cafes === null)) {
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
  } else if (!user.emailVerified) {
    body = (
      <Card>
        <StageHeading title={text.unverified.title} focus={false} />
        <p className="text-text">
          <Rich text={fill(text.unverified.text, { email: user.email })} />
        </p>
      </Card>
    );
  } else if (failed) {
    body = (
      <Card>
        <p role="alert" className="text-danger font-medium">
          {text.unavailable}
        </p>
      </Card>
    );
  } else {
    const cafe = cafeToShow(cafes ?? [], wanted);
    const others = (cafes ?? []).filter((c) => c.id !== cafe?.id);
    body = (
      <>
        {!cafe && (
          <Card>
            <StageHeading title={text.noCafe.title} focus={false} />
            <p className="text-text">
              <Rich text={fill(text.noCafe.text, { email: user.email })} />
            </p>
          </Card>
        )}
        {cafe && cafe.status === "draft" && <Draft data={data} cafe={cafe} />}
        {cafe && cafe.status !== "draft" && (
          <Sections data={data} cafe={cafe} email={user.email} />
        )}
        {others.length > 0 && (
          <nav aria-labelledby="cafe-others" className="text-sm">
            <p id="cafe-others" className="text-muted">
              {text.pick}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4">
              {others.map((c) => (
                <li key={c.id}>
                  <a
                    href={`/cafe?cafe=${encodeURIComponent(c.id)}`}
                    className="text-brand-ink min-h-tap inline-flex items-center font-medium underline underline-offset-4"
                  >
                    {c.settings.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
      {data?.backend === "demo" && <DemoNotice />}
      {body}
    </div>
  );
}

/** A cafe that has not been through setup: there is no site to manage yet. */
function Draft({ data, cafe }: { data: DataBundle; cafe: Cafe }) {
  const words = text.draft;
  return (
    <Card>
      <StageHeading
        title={fill(words.title, { name: cafe.settings.name })}
        focus={false}
      />
      <p className="text-text">
        <Rich text={fill(words.text, { id: encodeURIComponent(cafe.id) })} />
      </p>
      {data.backend === "demo" && (
        <div className="border-line bg-sunk space-y-3 rounded-lg border p-4">
          <p className="text-text">{words.demoSkip}</p>
          <Button variant="secondary" onClick={() => demoGoLive(cafe.id)}>
            {words.demoGo}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The time, as of now and every `everyMs` after, for what changes by waiting. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function Sections({
  data,
  cafe,
  email,
}: {
  data: DataBundle;
  cafe: Cafe;
  email: string;
}) {
  // One watch on the cafe's deployments, for what every section shows of it.
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const { id, ownerUid } = cafe;
  useEffect(
    () =>
      data.deployments.subscribeForCafe({ id, ownerUid }, setDeployments, () =>
        setDeployments([]),
      ),
    [data, id, ownerUid],
  );

  // And one on the requests, which the backend answers in minutes (not in demo
  // mode, which answers at once and has none).
  const [requests, setRequests] = useState<BackendRequest[]>([]);
  useEffect(
    () =>
      data.requests.subscribeForCafe({ id, ownerUid }, setRequests, () =>
        setRequests([]),
      ),
    [data, id, ownerUid],
  );
  const now = useNow(60_000);
  const waiting = requestToShow(requests, now);

  return (
    <>
      <CafeHeader
        cafe={cafe}
        email={email}
        demo={data.backend === "demo"}
        onSignOut={() => void data.auth.signOut()}
      />
      {waiting && <RequestStatus view={waiting} />}
      <UpdatesPanel
        data={data}
        cafe={cafe}
        deployments={deployments}
        requests={requests}
      />
      <BrandingPanel
        data={data}
        cafe={cafe}
        deployments={deployments}
        requests={requests}
      />
      <AccessPanel cafe={cafe} />
    </>
  );
}

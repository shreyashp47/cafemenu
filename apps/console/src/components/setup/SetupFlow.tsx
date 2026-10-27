"use client";

import { useEffect, useState } from "react";
import { useAccount, useDataBundle } from "@/lib/data/hooks";
import { fill, messages } from "@/lib/messages";
import type { Cafe } from "@/lib/platform/model";
import { cafeToSetUp } from "@/lib/setup/wizard";
import { DemoNotice } from "../DemoNotice";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { Card } from "./Card";
import { SetupWizard } from "./SetupWizard";
import { SignInForm } from "./SignInForm";

const { setup } = messages;

/**
 * Onboarding (#27): signed in, verified, with a draft cafe, the wizard;
 * otherwise whatever stands in the way, said plainly. The cafe is the one
 * in the address (`?cafe=`), else the owner's newest draft.
 */
export function SetupFlow() {
  const data = useDataBundle();
  const { ready, user } = useAccount(data);
  const [cafes, setCafes] = useState<Cafe[] | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);

  useEffect(() => {
    setWanted(new URLSearchParams(window.location.search).get("cafe"));
  }, []);

  const uid = user?.uid ?? null;
  useEffect(() => {
    setCafes(null);
    if (!data || !uid) return;
    return data.cafes.subscribeMine(uid, setCafes, () => setCafes([]));
  }, [data, uid]);

  let body: React.ReactNode;
  if (!data || !ready || (user && cafes === null)) {
    body = (
      <p role="status" className="text-muted">
        {setup.loading}
      </p>
    );
  } else if (!user) {
    body = <SignInForm data={data} />;
  } else if (!user.emailVerified) {
    body = (
      <Card>
        <StageHeading title={setup.unverified.title} focus={false} />
        <p className="text-text">
          <Rich text={fill(setup.unverified.text, { email: user.email })} />
        </p>
      </Card>
    );
  } else {
    const cafe = cafeToSetUp(cafes ?? [], wanted);
    const others = (cafes ?? []).filter((c) => c.id !== cafe?.id);
    body = (
      <>
        {!cafe && (
          <Card>
            <StageHeading title={setup.noCafe.title} focus={false} />
            <p className="text-text">
              <Rich text={fill(setup.noCafe.text, { email: user.email })} />
            </p>
          </Card>
        )}
        {cafe && cafe.status === "draft" && (
          <SetupWizard key={cafe.id} data={data} cafe={cafe} />
        )}
        {cafe && cafe.status !== "draft" && <Started cafe={cafe} />}
        {others.length > 0 && (
          <nav aria-labelledby="setup-others" className="text-sm">
            <p id="setup-others" className="text-muted">
              {setup.pick}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4">
              {others.map((c) => (
                <li key={c.id}>
                  <a
                    href={`/setup?cafe=${encodeURIComponent(c.id)}`}
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
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6 sm:py-16">
      {data?.backend === "demo" && <DemoNotice />}
      {body}
    </div>
  );
}

/** A cafe past these steps: where it is now, and the page it goes on at. */
function Started({ cafe }: { cafe: Cafe }) {
  const words = setup.started;
  const status = cafe.status === "draft" ? "provisioning" : cafe.status;
  return (
    <Card>
      <StageHeading
        title={fill(words.title, { name: cafe.settings.name })}
        focus={false}
      />
      <p className="text-text">
        <Rich text={fill(words[status], { site: cafe.site })} />
      </p>
      <p className="text-text">
        <Rich text={fill(words.manage, { id: encodeURIComponent(cafe.id) })} />
      </p>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { DataBundle } from "@/lib/data/types";
import { fill, messages } from "@/lib/messages";
import type { Cafe, Deployment, Release } from "@/lib/platform/model";
import { requestState } from "@/lib/owner/updates";
import { Rich } from "../Rich";
import { FormSection } from "../form/Field";
import { DeploymentList } from "./DeploymentList";
import { UpdateChoice } from "./UpdateChoice";
import { UpgradeRollback } from "./UpgradeRollback";

const { updates: text } = messages.cafe;

/**
 * Updates: the version running, how the cafe follows releases, Upgrade and
 * Roll back with the release notes, and what CafeMenu has done to the cafe.
 */
export function UpdatesPanel({
  data,
  cafe,
  deployments,
}: {
  data: DataBundle;
  cafe: Cafe;
  deployments: readonly Deployment[];
}) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  useEffect(() => {
    let live = true;
    data.releases.list().then(
      (list) => {
        if (live) setReleases(list);
      },
      // Without the release records there are no notes and no offer to show.
      () => {
        if (live) setReleases([]);
      },
    );
    return () => {
      live = false;
    };
  }, [data]);

  const { current, previous } = cafe.release;
  return (
    <FormSection id="updates" title={text.title}>
      <p className="text-text">{text.lead}</p>

      <div>
        <p className="text-ink font-semibold">{text.running.label}</p>
        {current ? (
          <>
            <p className="font-display text-ink text-3xl">{current}</p>
            {previous && (
              <p className="text-muted">
                <Rich text={fill(text.running.before, { version: previous })} />
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">{text.running.none}</p>
        )}
      </div>

      <UpdateChoice data={data} cafe={cafe} />
      <UpgradeRollback
        data={data}
        cafe={cafe}
        releases={releases}
        state={requestState(cafe, deployments)}
      />
      <DeploymentList deployments={deployments} />
    </FormSection>
  );
}

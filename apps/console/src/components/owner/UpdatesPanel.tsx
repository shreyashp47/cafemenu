"use client";

import { useEffect, useState } from "react";
import type { DataBundle } from "@/lib/data/types";
import { fill, messages } from "@/lib/messages";
import type {
  BackendRequest,
  Cafe,
  Deployment,
  Release,
} from "@/lib/platform/model";
import { supportedLines, supportView } from "@/lib/owner/support";
import { requestState } from "@/lib/owner/updates";
import { NOTICE_DAYS } from "@cafemenu/shared/support-window";
import { Rich } from "../Rich";
import { FormSection } from "../form/Field";
import { DeploymentList } from "./DeploymentList";
import { SupportNotice } from "./SupportNotice";
import { UpdateChoice } from "./UpdateChoice";
import { UpgradeRollback } from "./UpgradeRollback";

const { updates: text } = messages.cafe;
const { policy } = text;

/**
 * Updates: the version running, how the cafe follows releases, Upgrade and
 * Roll back with the release notes, and what CafeMenu has done to the cafe.
 * A cafe that stays on a line the support window has dropped is told so, with
 * the date to upgrade by (#35). `now` is for tests.
 */
export function UpdatesPanel({
  data,
  cafe,
  deployments,
  requests = [],
  now,
}: {
  data: DataBundle;
  cafe: Cafe;
  deployments: readonly Deployment[];
  /** What the owner has asked and the backend has not finished. */
  requests?: readonly BackendRequest[];
  now?: number;
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
  const [loadedAt] = useState(() => Date.now());
  const notice = releases
    ? supportView(cafe.release, releases, now ?? loadedAt)
    : null;
  const lines = releases ? supportedLines(releases) : [];
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

      {notice && <SupportNotice view={notice} />}

      <UpdateChoice data={data} cafe={cafe} />
      <p className="text-muted text-sm">
        <Rich
          text={fill(policy.text, {
            now: lines.length
              ? fill(policy.now, { lines: lines.join(" and ") })
              : "",
            days: NOTICE_DAYS,
          })}
        />
      </p>
      <UpgradeRollback
        data={data}
        cafe={cafe}
        releases={releases}
        state={requestState(cafe, deployments, requests)}
      />
      <DeploymentList deployments={deployments} />
    </FormSection>
  );
}

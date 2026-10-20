/**
 * The exact documents an owner writes, built in one place so the Firestore
 * adapter and the demo store cannot drift apart. firestore.rules pins this
 * shape (`allow create` on /cafes), and scripts/rules-test.mjs writes the same
 * one.
 */

import type { CafeSettings } from "@cafemenu/shared";
import type { CafeRelease } from "./model";
import { releaseChoiceOf, type ReleaseChoice } from "./validate";

export interface CafeRecord<Time> {
  ownerUid: string;
  ownerEmail: string;
  projectId: string | null;
  site: string;
  settings: CafeSettings;
  release: CafeRelease;
  status: "draft";
  createdAt: Time;
  updatedAt: Time;
}

/**
 * A new cafe: a draft on no release yet. `settings` must already have passed
 * checkNewCafe(). `now` is serverTimestamp() for Firestore, whose rules
 * require it, and Date.now() in the demo store.
 */
export function newCafeRecord<Time>(
  owner: { uid: string; email: string },
  fields: {
    site: string;
    settings: CafeSettings;
    projectId?: string | null;
    release?: Partial<ReleaseChoice>;
  },
  now: Time,
): CafeRecord<Time> {
  const choice = releaseChoiceOf(fields.release);
  return {
    ownerUid: owner.uid,
    ownerEmail: owner.email,
    projectId: fields.projectId ?? null,
    site: fields.site,
    settings: {
      ...fields.settings,
      utcOffsets: { ...fields.settings.utcOffsets },
      tables: [...fields.settings.tables],
    },
    release: {
      channel: choice.channel,
      pinned: choice.pinned,
      current: null,
      previous: null,
    },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

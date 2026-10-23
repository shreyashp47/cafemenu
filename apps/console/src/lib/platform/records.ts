/**
 * The exact documents an owner writes, built in one place so the Firestore
 * adapter and the demo store cannot drift apart. firestore.rules pins this
 * shape (`allow create` on /cafes), and scripts/rules-test.mjs writes the same
 * one.
 */

import type { CafeSettings } from "@cafemenu/shared";
import type { CafeRelease, StartingMenu } from "./model";
import { releaseChoiceOf, type ReleaseChoice } from "./validate";

export interface CafeRecord<Time> {
  ownerUid: string;
  ownerEmail: string;
  projectId: string | null;
  site: string;
  region: string;
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
    region: string;
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
    region: fields.region,
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

/**
 * The setup documents, `cafes/{cafeId}/setup/{logo,menu}`, pinned by the
 * rules as the cafe is. The PNG is in whatever form the store keeps bytes:
 * Firestore's Bytes, or base64 in the demo store. Both must already have
 * passed the checks in validate.ts.
 */
export function logoRecord<Bytes, Time>(
  png: Bytes,
  now: Time,
): { png: Bytes; updatedAt: Time } {
  return { png, updatedAt: now };
}

export function startingMenuRecord<Time>(
  menu: StartingMenu,
  now: Time,
): StartingMenu & { updatedAt: Time } {
  return {
    source: menu.source,
    template: menu.template,
    currency: menu.currency,
    items: menu.items.map((item) => ({
      name: item.name,
      category: item.category,
      description: item.description,
      price: item.price,
      available: item.available,
    })),
    updatedAt: now,
  };
}

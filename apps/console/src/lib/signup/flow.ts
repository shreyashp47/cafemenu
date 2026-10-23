/**
 * Where an owner is in sign-up (PLAN.md, "The owner's steps", 1 and 2), and
 * saving the cafe once they may:
 *
 *   form    filling in the form
 *   verify  account made; waiting for the link in the email to be clicked.
 *           The rules refuse every write until it is, so this gates the rest
 *   create  verified, with a draft: saving the cafe, its logo and its menu
 *   done    saved; onboarding (#27) takes over from here
 */

import type { Cafe, PlatformUser } from "../platform/model";
import type { DataBundle } from "../data/types";
import { fromBase64 } from "../bytes";
import { cafeOf, type SignupForm } from "./form";
import type { SignupDraft } from "./draft";

export type SignupStage = "loading" | "form" | "verify" | "create" | "done";

export function signupStage({
  ready,
  user,
  draft,
  created,
}: {
  /** Whether the account state has arrived yet. */
  ready: boolean;
  user: PlatformUser | null;
  draft: SignupDraft | null;
  /** The cafe this page has just saved, if any. */
  created: SavedCafe | null;
}): SignupStage {
  if (!ready) return "loading";
  if (created) return "done";
  if (!user) return "form";
  if (!user.emailVerified) return "verify";
  // A draft left by another account in this browser is not this owner's.
  const mine = draft && sameEmail(draft.email, user.email) ? draft : null;
  return mine ? "create" : "form";
}

export const sameEmail = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the page needs of a cafe it has saved. */
export type SavedCafe = Pick<Cafe, "id" | "site" | "settings">;

/**
 * Saves the cafe from the draft: the cafe first (once: `onCafe` records its
 * id in the draft, so a retry after a failure goes straight on), then the
 * logo and the starting menu, which the rules only take for a draft cafe that
 * exists. Safe to run again: the setup documents are replaced, not added.
 */
export async function saveCafe(
  data: Pick<DataBundle, "cafes" | "setup">,
  draft: SignupDraft,
  onCafe: (cafeId: string) => void,
): Promise<SavedCafe> {
  const form = { ...draft.form, password: "" } satisfies SignupForm;
  const { input, menu } = cafeOf(form);
  let cafe: SavedCafe;
  if (draft.cafeId) {
    cafe = { id: draft.cafeId, site: input.site, settings: input.settings };
  } else {
    cafe = await data.cafes.create(input);
    onCafe(cafe.id);
  }
  if (form.logo) {
    await data.setup.saveLogo(cafe.id, fromBase64(form.logo.png));
  }
  if (menu) await data.setup.saveMenu(cafe, menu);
  return cafe;
}

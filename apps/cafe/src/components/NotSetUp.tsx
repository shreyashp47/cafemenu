"use client";

/**
 * What a signed-in account with no `/staff/{uid}` document sees (issue #33).
 *
 * Before this, the symptom was "I signed in and the screen is empty": the rules
 * refuse such an account everything, so the board sat on a permissions error
 * that told nobody what to do. Now it says so in plain words and shows exactly
 * what the owner needs to set the account up: an invite link from the Staff
 * page (issue #15), or the email for the seed command and the uid for anyone
 * doing it in the console. A removed team member lands here too.
 */

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { StaffUser } from "@/lib/data/types";
import { t } from "@/lib/i18n";
import { rich } from "@/lib/i18n-rich";

export function NotSetUp({
  user,
  onSignOut,
}: {
  user: Pick<StaffUser, "uid" | "email">;
  onSignOut: () => void;
}) {
  const email = user.email || "you@example.com";
  return (
    <main className="shell flex min-h-svh flex-col items-center justify-center gap-4 py-10 text-center">
      <Mascot mood="worry" size={120} />
      <h1 className="font-hand text-primary text-4xl">
        {t("notSetUp.notSetUp")}
      </h1>
      <p className="text-body max-w-sm">{t("notSetUp.accountIsntSet")}</p>

      <Card className="w-full max-w-sm p-4 text-left text-sm">
        <p className="text-ink font-semibold">{t("notSetUp.showOwner")}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">{t("notSetUp.email")}</dt>
          <dd className="text-ink break-all select-all">
            {user.email || t("notSetUp.none")}
          </dd>
          <dt className="text-muted">{t("notSetUp.userId")}</dt>
          <dd className="tnum text-ink break-all select-all">{user.uid}</dd>
        </dl>
        <p className="text-muted mt-3">
          {rich("notSetUp.inviteLink", {
            b: (c) => <span className="text-ink font-semibold">{c}</span>,
          })}
        </p>
        <p className="border-line bg-cream-soft text-ink mt-1 rounded-sm border-2 px-2 py-1.5 text-xs break-all select-all">
          {t("notSetUp.seedCommand", { email })}
        </p>
      </Card>

      <Button size="lg" variant="secondary" onClick={onSignOut}>
        {t("notSetUp.signOut")}
      </Button>
    </main>
  );
}

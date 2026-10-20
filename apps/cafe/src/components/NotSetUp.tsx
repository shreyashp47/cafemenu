"use client";

/**
 * What a signed-in account with no `/staff/{uid}` document sees (issue #33).
 *
 * Before this, the symptom was "I signed in and the screen is empty": the rules
 * refuse such an account everything, so the board sat on a permissions error
 * that told nobody what to do. Now it says so in plain words and shows exactly
 * what the owner needs to set the account up — the email for the seed command,
 * and the uid for anyone doing it in the console.
 */

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { StaffUser } from "@/lib/data/types";

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
      <h1 className="font-hand text-primary text-4xl">Not set up yet</h1>
      <p className="text-body max-w-sm">
        Your account isn&apos;t set up yet — ask the owner to add you. You are
        signed in, but this account has not been given a staff role, so the
        order board stays locked.
      </p>

      <Card className="w-full max-w-sm p-4 text-left text-sm">
        <p className="text-ink font-semibold">Show this to the owner</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Email</dt>
          <dd className="text-ink break-all select-all">
            {user.email || "(none)"}
          </dd>
          <dt className="text-muted">User ID</dt>
          <dd className="tnum text-ink break-all select-all">{user.uid}</dd>
        </dl>
        <p className="text-muted mt-3">The owner runs, from the project:</p>
        <p className="border-line bg-cream-soft text-ink mt-1 rounded-sm border-2 px-2 py-1.5 text-xs break-all select-all">
          npm run seed:staff -- --email={email} --role=staff
        </p>
      </Card>

      <Button size="lg" variant="secondary" onClick={onSignOut}>
        Sign out
      </Button>
    </main>
  );
}

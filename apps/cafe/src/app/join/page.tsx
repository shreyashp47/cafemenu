"use client";

/**
 * Where an invite link lands: /join#{invite id} (issue #15).
 *
 * The person signs up with their email and a password, or signs in if that
 * email already has an account, and gives their name. Then one batch writes
 * their /staff record with the invite's role and marks the invite used
 * (StaffRepository.join), which firestore.rules allows only against an open
 * invite. The id is read from the fragment, not the query string, so it is
 * never sent to the server (src/lib/invites.ts).
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Mascot } from "@/components/Mascot";
import {
  DataProvider,
  useStaffRepo,
  useStaffSession,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Loading } from "@/components/ui/Loading";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import type { StaffUser } from "@/lib/data/types";
import { friendlyJoinError } from "@/lib/friendly-errors";
import {
  MAX_STAFF_NAME,
  cleanStaffName,
  inviteIdFromHash,
  inviteState,
  type Invite,
  type InviteRole,
} from "@/lib/invites";
import { t } from "@/lib/i18n";
import { rich } from "@/lib/i18n-rich";

export default function JoinPage() {
  return (
    <DataProvider>
      <JoinScreen />
    </DataProvider>
  );
}

/** `undefined` until the page has read its address. */
function useInviteId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setId(inviteIdFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return id;
}

function JoinScreen() {
  const id = useInviteId();
  const repo = useStaffRepo();
  const { user, loading } = useStaffSession();
  const [invite, setInvite] = useState<{
    id: string;
    value: Invite | null;
    error: unknown;
  } | null>(null);
  const [joined, setJoined] = useState<{
    role: InviteRole;
    name: string;
  } | null>(null);
  const [now, setNow] = useState(0);
  // Joining changes the person's role mid-submit, which must not swap the
  // form for "already on the team" before the welcome.
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!repo || !id) return;
    let alive = true;
    setNow(Date.now());
    repo.readInvite(id).then(
      (value) => alive && setInvite({ id, value, error: null }),
      (error: unknown) => alive && setInvite({ id, value: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [repo, id]);

  if (joined) return <Joined {...joined} />;
  if (id === null) {
    return (
      <Message title={t("join.linkIncomplete")}>
        {t("join.copyWholeInvite")}
      </Message>
    );
  }
  const loaded = invite !== null && invite.id === id ? invite : null;
  if (id === undefined || loading || !loaded) {
    return <Loading label={t("join.openingInvite")} />;
  }
  if (loaded.error) {
    return (
      <Message title={t("join.cantOpenInvite")}>
        {friendlyJoinError(loaded.error)}
      </Message>
    );
  }
  if (user && user.role !== "unassigned" && !joining) {
    return <AlreadyOnTeam email={user.email} />;
  }
  const found = loaded.value;
  const state = found ? inviteState(found, now) : null;
  if (!found || state !== "open") {
    return (
      <Message title={t("join.inviteDoesntWork")}>
        {state === "expired" ? t("join.expiredBody") : t("join.usedBody")}
      </Message>
    );
  }
  return (
    <JoinForm invite={found} onJoining={setJoining} onJoined={setJoined} />
  );
}

function JoinForm({
  invite,
  onJoining,
  onJoined,
}: {
  invite: Invite;
  onJoining: (joining: boolean) => void;
  onJoined: (joined: { role: InviteRole; name: string }) => void;
}) {
  const repo = useStaffRepo();
  const { user, signIn, signUp, signOut } = useStaffSession();
  const cafeName = useCafeSettings().settings.name;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Held still while submitting: signing up makes `user` appear mid-submit,
  // which must not swap the form for the "joining as" one.
  const [held, setHeld] = useState<StaffUser | null | undefined>(undefined);
  const signedIn = held === undefined ? user : held;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return;
    const clean = cleanStaffName(name);
    if (!clean) {
      setError(t("join.enterName"));
      return;
    }
    setBusy(true);
    setError(null);
    setHeld(signedIn);
    onJoining(true);
    try {
      if (!signedIn) await signUpOrSignIn(email, password);
      const role = await repo.join(invite.id, clean);
      onJoined({ role, name: clean });
    } catch (err) {
      setError(friendlyJoinError(err));
      setBusy(false);
      setHeld(undefined);
      onJoining(false);
    }
  }

  async function signUpOrSignIn(email: string, password: string) {
    try {
      await signUp(email, password);
    } catch (err) {
      if ((err as { code?: unknown })?.code !== "auth/email-already-in-use") {
        throw err;
      }
      // An existing account (a removed barista coming back, or someone who
      // works at two cafes on one login): its own password signs it in.
      try {
        await signIn(email, password);
      } catch {
        throw new Error(t("join.wrongPassword"));
      }
    }
  }

  return (
    <main className="shell flex min-h-svh flex-col items-center justify-center gap-4 py-10">
      <Mascot size={120} />
      <div className="text-center">
        <h1 className="font-hand text-primary text-4xl">
          {t("join.joinTeam")}
        </h1>
        <p className="text-muted text-sm">
          {cafeName
            ? t("join.invitedNamed", {
                name: cafeName,
                role: roleName(invite.role),
              })
            : t("join.invited", { role: roleName(invite.role) })}
        </p>
      </div>

      <form
        onSubmit={submit}
        className="border-line bg-paper shadow-card flex w-full max-w-sm flex-col gap-3 rounded-lg border-2 p-4"
      >
        <Field
          label={t("join.name")}
          htmlFor="join-name"
          hint={t("join.teamSees")}
        >
          <Input
            id="join-name"
            autoComplete="name"
            required
            maxLength={MAX_STAFF_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {signedIn ? (
          <p className="text-muted text-sm">
            {rich(
              "join.joiningAs",
              { b: (c) => <span className="text-ink font-semibold">{c}</span> },
              { email: signedIn.email },
            )}{" "}
            <button
              type="button"
              className="text-primary font-semibold underline"
              onClick={() => void signOut()}
            >
              {t("join.not")}
            </button>
          </p>
        ) : (
          <>
            <Field label={t("join.email")} htmlFor="join-email">
              <Input
                id="join-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label={t("join.password")}
              htmlFor="join-password"
              hint={t("join.least6Characters")}
            >
              <Input
                id="join-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        )}

        {error ? (
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" fullWidth disabled={busy || !repo}>
          {busy ? t("join.joining") : t("join.join")}
        </Button>
      </form>
    </main>
  );
}

/** "an owner" or "staff", as it reads after "…as". */
function roleName(role: InviteRole): string {
  return role === "owner" ? t("join.asOwner") : t("join.asStaff");
}

function Joined({ role, name }: { role: InviteRole; name: string }) {
  return (
    <Message title={t("join.welcome", { name })} mood="happy">
      {t("join.onTheTeam", { role: roleName(role) })}
      <span className="mt-4 block">
        <Link href={role === "owner" ? "/admin" : "/staff"}>
          <Button size="lg">
            {role === "owner"
              ? t("join.openDashboard")
              : t("join.openOrderBoard")}
          </Button>
        </Link>
      </span>
    </Message>
  );
}

function AlreadyOnTeam({ email }: { email: string }) {
  const { signOut } = useStaffSession();
  return (
    <Message title={t("join.youreAlreadyTeam")}>
      {t("join.signedInAs", { who: email || t("join.aTeamMember") })}
      <span className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/staff">
          <Button>{t("join.openOrderBoard")}</Button>
        </Link>
        <Button variant="ghost" onClick={() => void signOut()}>
          {t("join.signOut")}
        </Button>
      </span>
    </Message>
  );
}

function Message({
  title,
  mood = "worry",
  children,
}: {
  title: string;
  mood?: "worry" | "happy";
  children: React.ReactNode;
}) {
  return (
    <main className="shell flex min-h-svh flex-col items-center justify-center gap-4 py-10 text-center">
      <Mascot mood={mood} size={120} />
      <h1 className="font-hand text-primary text-4xl">{title}</h1>
      <Card className="text-body w-full max-w-sm p-4">{children}</Card>
    </main>
  );
}

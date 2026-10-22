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
      <Message title="This link is incomplete">
        Copy the whole invite link from the message the owner sent, or ask them
        for a new one.
      </Message>
    );
  }
  const loaded = invite !== null && invite.id === id ? invite : null;
  if (id === undefined || loading || !loaded) {
    return <Loading label="Opening your invite…" />;
  }
  if (loaded.error) {
    return (
      <Message title="Can't open the invite">
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
      <Message title="This invite doesn't work any more">
        {state === "expired"
          ? "It has expired: invites work for seven days."
          : "It has been used or cancelled."}{" "}
        Ask the owner for a new link.
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
      setError("Enter your name, as the team will see it.");
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
        throw new Error(
          "That email already has an account, and that isn't its password.",
        );
      }
    }
  }

  return (
    <main className="shell flex min-h-svh flex-col items-center justify-center gap-4 py-10">
      <Mascot size={120} />
      <div className="text-center">
        <h1 className="font-hand text-primary text-4xl">Join the team</h1>
        <p className="text-muted text-sm">
          {cafeName ? `${cafeName} invited you` : "You're invited"} as{" "}
          {invite.role === "owner" ? "an owner" : "staff"}.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="border-line bg-paper shadow-card flex w-full max-w-sm flex-col gap-3 rounded-lg border-2 p-4"
      >
        <Field label="Your name" htmlFor="join-name" hint="As the team sees it">
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
            Joining as{" "}
            <span className="text-ink font-semibold">{signedIn.email}</span>.{" "}
            <button
              type="button"
              className="text-primary font-semibold underline"
              onClick={() => void signOut()}
            >
              Not you?
            </button>
          </p>
        ) : (
          <>
            <Field label="Email" htmlFor="join-email">
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
              label="Password"
              htmlFor="join-password"
              hint="At least 6 characters. Already have an account? Use its password."
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
          {busy ? "Joining…" : "Join"}
        </Button>
      </form>
    </main>
  );
}

function Joined({ role, name }: { role: InviteRole; name: string }) {
  return (
    <Message title={`Welcome, ${name}!`} mood="happy">
      You&apos;re on the team as {role === "owner" ? "an owner" : "staff"}. Sign
      in with this email and password on any device.
      <span className="mt-4 block">
        <Link href={role === "owner" ? "/admin" : "/staff"}>
          <Button size="lg">
            {role === "owner" ? "Open the dashboard" : "Open the order board"}
          </Button>
        </Link>
      </span>
    </Message>
  );
}

function AlreadyOnTeam({ email }: { email: string }) {
  const { signOut } = useStaffSession();
  return (
    <Message title="You're already on the team">
      This device is signed in as {email || "a team member"}. To join as someone
      else with this invite, sign out first.
      <span className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/staff">
          <Button>Open the order board</Button>
        </Link>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
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

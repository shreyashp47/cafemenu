"use client";

/**
 * The owner's team (issue #15): who can open the order board, and invite
 * links for adding someone with no terminal.
 *
 * An invite is a link the owner sends, by message or however they like. It
 * works once, for seven days, and gives exactly the role chosen here; the
 * person signs up on /join and is on the board straight away. Removing
 * someone deletes their /staff record: they keep their login, and get the
 * "not set up yet" screen from then on. firestore.rules (/staff, /invites)
 * enforces all of it; this page is the owner's way in.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useStaffRepo,
  useStaffSession,
  useTeam,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Input";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { friendlyTeamError } from "@/lib/friendly-errors";
import {
  INVITE_DAYS,
  inviteExpiresAt,
  inviteLink,
  inviteState,
  isLastOwner,
  type Invite,
  type InviteRole,
  type StaffMember,
} from "@/lib/invites";

const DAY_MS = 24 * 60 * 60 * 1000;

const ROLE_LABEL: Record<InviteRole, string> = {
  staff: "Staff",
  owner: "Owner",
};

export default function StaffAdminPage() {
  const repo = useStaffRepo();
  const { user } = useStaffSession();
  const { members, invites, loading, error } = useTeam();
  const { settings } = useCafeSettings();
  const [here, setHere] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    setHere(window.location.origin);
    setNow(Date.now());
    // Keeps "expires in" honest on a dashboard left open for days.
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The cafe's own address when the settings have one, so a link made on a
  // preview deploy still points at the real site.
  const origin = settings.baseUrl ?? here;
  const linkFor = useCallback((id: string) => inviteLink(origin, id), [origin]);

  const pending = useMemo(
    () =>
      invites
        .filter((i) => i.usedBy === null)
        .sort((a, b) => b.createdAt - a.createdAt),
    [invites],
  );
  const team = useMemo(
    () =>
      [...members].sort(
        (a, b) =>
          (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1) ||
          a.name.localeCompare(b.name),
      ),
    [members],
  );

  return (
    <div className="flex flex-col gap-4 pb-8">
      <NewInvite
        disabled={!repo || !origin}
        create={async (role) => {
          if (!repo) throw new Error("Storage is not ready yet.");
          return linkFor((await repo.createInvite(role)).id);
        }}
      />

      {error ? (
        <Card className="p-4">
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            Couldn&apos;t load the team. Check the connection and reload.
          </p>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="text-lg">Open invites</h2>
        <p className="text-muted mt-0.5 text-sm">
          Links nobody has used yet. Cancel one you sent to the wrong person.
        </p>
        {loading ? (
          <p className="text-muted mt-3 text-sm">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-muted mt-3 text-sm">None right now.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                now={now}
                link={linkFor(invite.id)}
                onDelete={() => repo?.deleteInvite(invite.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-lg">Team</h2>
        <p className="text-muted mt-0.5 text-sm">
          Staff run the order board. Owners also get this dashboard.
        </p>
        {loading ? (
          <p className="text-muted mt-3 text-sm">Loading…</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {team.map((member) => (
              <MemberRow
                key={member.uid}
                member={member}
                isMe={member.uid === user?.uid}
                lastOwner={isLastOwner(members, member.uid)}
                onSetRole={(role) => repo?.setRole(member.uid, role)}
                onRemove={() => repo?.remove(member.uid)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewInvite({
  disabled,
  create,
}: {
  disabled: boolean;
  create: (role: InviteRole) => Promise<string>;
}) {
  const [role, setRole] = useState<InviteRole>("staff");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setLink(await create(role));
    } catch (err) {
      setError(friendlyTeamError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-lg">Add someone</h2>
      <p className="text-muted mt-0.5 mb-3 text-sm">
        Make an invite link and send it to them. It works once, for{" "}
        {INVITE_DAYS} days. They sign up with their own email and password.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <Field label="They join as" htmlFor="invite-role">
            <Select
              id="invite-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as InviteRole);
                setLink(null);
              }}
            >
              <option value="staff">Staff: the order board</option>
              <option value="owner">Owner: also this dashboard</option>
            </Select>
          </Field>
        </div>
        <Button onClick={() => void submit()} disabled={disabled || busy}>
          {busy ? "Making…" : "Make invite link"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
      {link ? (
        <div className="mt-3">
          <Field
            label={`${ROLE_LABEL[role]} invite link`}
            htmlFor="invite-link"
            hint="Anyone with this link can join, so send it only to them."
          >
            <Input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="text-sm"
            />
          </Field>
          <div className="mt-2">
            <CopyButton text={link} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function CopyButton({ text, size }: { text: string; size?: "sm" }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, or not https): the link is on screen to
      // copy by hand.
      setCopied(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size={size ?? "md"}
      onClick={() => void copy()}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function InviteRow({
  invite,
  now,
  link,
  onDelete,
}: {
  invite: Invite;
  now: number;
  link: string;
  onDelete: () => Promise<void> | undefined;
}) {
  const [error, setError] = useState<string | null>(null);
  const expired = now > 0 && inviteState(invite, now) === "expired";
  // Rounded: `now` can be a minute older than an invite made just now.
  const days = Math.round((inviteExpiresAt(invite) - now) / DAY_MS);

  return (
    <li className="border-line-soft flex flex-wrap items-center gap-2 rounded-sm border-2 p-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-ink font-semibold">
          {ROLE_LABEL[invite.role]} invite
        </p>
        {now > 0 ? (
          <p className="text-muted text-sm">
            {expired
              ? "Expired"
              : days < 1
                ? "Expires in under a day"
                : `Expires in ${days} ${days === 1 ? "day" : "days"}`}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            {error}
          </p>
        ) : null}
      </div>
      {expired ? null : <CopyButton text={link} size="sm" />}
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          setError(null);
          try {
            await onDelete();
          } catch (err) {
            setError(friendlyTeamError(err));
          }
        }}
      >
        {expired ? "Clear" : "Cancel invite"}
      </Button>
    </li>
  );
}

function MemberRow({
  member,
  isMe,
  lastOwner,
  onSetRole,
  onRemove,
}: {
  member: StaffMember;
  isMe: boolean;
  lastOwner: boolean;
  onSetRole: (role: InviteRole) => Promise<void> | undefined;
  onRemove: () => Promise<void> | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The cafe always keeps an owner, or nobody could get back in here.
  const locked = isMe && lastOwner;

  async function run(action: () => Promise<void> | undefined) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(friendlyTeamError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-line-soft rounded-sm border-2 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate font-semibold">
            {member.name}
            {isMe ? (
              <span className="text-muted font-normal"> (you)</span>
            ) : null}
          </p>
          {member.email ? (
            <p className="text-muted truncate text-sm">{member.email}</p>
          ) : null}
        </div>
        <label className="sr-only" htmlFor={`role-${member.uid}`}>
          Role for {member.name}
        </label>
        <Select
          id={`role-${member.uid}`}
          value={member.role}
          disabled={locked || busy}
          onChange={(e) =>
            void run(() => onSetRole(e.target.value as InviteRole))
          }
          className="w-auto min-w-32"
        >
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          disabled={locked || busy}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      </div>
      {locked ? (
        <p className="text-muted mt-1.5 text-sm">
          You&apos;re the only owner. Make someone else an owner before you step
          down.
        </p>
      ) : null}
      {confirming ? (
        <div className="bg-cream-soft mt-2 rounded-sm p-2.5 text-sm">
          <p className="text-ink">
            Remove {member.name}? They keep their login but can&apos;t open the
            order board{member.role === "owner" ? " or this dashboard" : ""}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void run(onRemove)}
            >
              Remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="text-berry-deep mt-1.5 text-sm font-semibold"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

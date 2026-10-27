"use client";

import { useState, type FormEvent } from "react";
import { ADMIN_POLICY, type AdminPolicy } from "@cafemenu/shared/admin-policy";
import { errorText, fill, messages } from "@/lib/messages";
import { adminParams, type ActionProblem } from "@/lib/admin/actions";
import type { DataBundle } from "@/lib/data/types";
import type { OwnerRecord, PlatformUser } from "@/lib/platform/model";
import { Button, TextButton } from "../Button";
import { Rich } from "../Rich";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";

const { admins: text, actions } = messages.admin;

/**
 * Who the admins are (#78, section 3.5), from the owners directory, with a
 * way to remove one (never the last) and to appoint another. Appointing is
 * built in but off while the policy keeps it to the first admin
 * (APPOINT_OTHER_ADMINS); the backend checks the same policy.
 */
export function AdminsPanel({
  data,
  user,
  owners,
  policy = ADMIN_POLICY,
}: {
  data: DataBundle;
  user: PlatformUser;
  owners: OwnerRecord[];
  policy?: AdminPolicy;
}) {
  const admins = owners
    .filter((o) => o.admin)
    .sort((a, b) => a.email.localeCompare(b.email, "en"));
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<ActionProblem | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAct = data.directory.canAct;

  async function ask(
    kind: "appoint-admin" | "remove-admin",
    address: string,
    words: string,
  ) {
    const checked = adminParams(address, words);
    if (!checked.ok) {
      setProblem(checked.problem);
      return false;
    }
    setProblem(null);
    setError(null);
    try {
      await data.directory.ask({ cafeId: null, kind, params: checked.params });
      setStatus(actions.asked);
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    }
  }

  async function appoint(event: FormEvent) {
    event.preventDefault();
    if (await ask("appoint-admin", email, note)) {
      setEmail("");
      setNote("");
    }
  }

  const appointError =
    problem === "email" || problem === "note-long"
      ? actions.problems[problem]
      : undefined;

  return (
    <FormSection id="admin-admins" title={text.title}>
      <p className="text-text">
        <Rich text={text.explain} />
      </p>
      {admins.length === 0 ? (
        <p className="text-muted">{text.none}</p>
      ) : (
        <ul className="divide-line divide-y">
          {admins.map((admin) => (
            <li
              key={admin.uid}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="text-ink break-all">
                {admin.email}
                {admin.uid === user.uid && (
                  <span className="text-muted"> {text.you}</span>
                )}
              </span>
              {canAct &&
                (admins.length > 1 ? (
                  <TextButton
                    aria-label={fill(text.removeLabel, { email: admin.email })}
                    onClick={() => void ask("remove-admin", admin.email, "")}
                  >
                    {text.remove}
                  </TextButton>
                ) : (
                  <span className="text-muted text-sm">{text.last}</span>
                ))}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3">
        <h3 className="text-ink text-lg font-semibold">{text.appoint.title}</h3>
        {!policy.appointOtherAdmins ? (
          <p className="text-text">
            <Rich text={text.appoint.off} />
          </p>
        ) : !canAct ? (
          <p className="text-text">
            <Rich text={actions.cannot} />
          </p>
        ) : (
          <form className="space-y-3" onSubmit={appoint} noValidate>
            <Field
              id="admin-appoint-email"
              label={text.appoint.email}
              error={appointError}
            >
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...controlProps("admin-appoint-email", {
                  error: appointError,
                })}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
            <Field id="admin-appoint-note" label={text.appoint.note}>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                {...controlProps("admin-appoint-note", {})}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
            <Button type="submit">{text.appoint.submit}</Button>
          </form>
        )}
      </div>
      {status && (
        <p role="status" className="text-brand-ink font-medium">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger font-medium">
          {error}
        </p>
      )}
    </FormSection>
  );
}

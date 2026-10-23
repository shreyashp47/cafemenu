"use client";

import { useState, type FormEvent } from "react";
import type { DataBundle } from "@/lib/data/types";
import { errorText, messages } from "@/lib/messages";
import { Button } from "../Button";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";
import { Field, controlClass, controlProps } from "../form/Field";
import { Card } from "./Card";

const { signIn: text } = messages.setup;

/** For an owner who left and comes back signed out, or on another device. */
export function SignInForm({ data }: { data: DataBundle }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Signed in, the page moves on by itself.
      await data.auth.signIn(email.trim(), password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card>
      <StageHeading title={text.title} focus={false} />
      <p className="text-text">{text.text}</p>
      <form noValidate onSubmit={send} className="space-y-5">
        <Field id="signin-email" label={text.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            {...controlProps("signin-email", {})}
            className={`${controlClass} min-h-tap`}
          />
        </Field>
        <Field id="signin-password" label={text.password}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            {...controlProps("signin-password", {})}
            className={`${controlClass} min-h-tap`}
          />
        </Field>
        <div aria-live="polite">
          {error && (
            <p className="bg-danger-soft text-danger rounded-md p-3 font-medium">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy ? text.submitting : text.submit}
        </Button>
      </form>
      <p className="text-muted">
        <Rich text={text.new} />
      </p>
    </Card>
  );
}

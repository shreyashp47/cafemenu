"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMoney, starterPrice } from "@cafemenu/shared";
import type { DataBundle } from "@/lib/data/types";
import { errorText, fill, messages } from "@/lib/messages";
import type { PlatformUser } from "@/lib/platform/model";
import { guessCountry } from "@/lib/signup/countries";
import { draftOf, type SignupDraft } from "@/lib/signup/draft";
import {
  emptyForm,
  firstProblem,
  formProblems,
  importSettingsOf,
  menuOf,
  settleMenu,
  withCountry,
  withName,
  withSite,
  type FieldName,
  type FieldProblems,
  type SignupForm as Form,
} from "@/lib/signup/form";
import { Button, TextButton } from "../Button";
import { Rich } from "../Rich";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import { LookFields } from "./LookFields";
import { MenuFields } from "./MenuFields";
import { PlaceFields } from "./PlaceFields";
import { SiteField, useSiteCheck } from "./SiteField";
import { continueUrl } from "./continue-url";

const { signup } = messages;
const problemText = signup.problems;

/** The control each field's problem takes the focus to. */
const FOCUS: Record<FieldName, string> = {
  name: "signup-name",
  site: "signup-site",
  tables: "signup-tables",
  country: "signup-country",
  currency: "signup-currency",
  timeZone: "signup-timezone",
  locale: "signup-locale",
  region: "signup-region",
  accent: "signup-accent-hex",
  menu: "signup-menu-list",
  email: "signup-email",
  password: "signup-password",
};

/** What a flat white costs in an American cafe, for the preview. */
const FLAT_WHITE_CENTS = 450;

/** Where a field's problem sends the focus, as the form now stands. */
function focusTarget(field: FieldName, form: Form): string {
  if (field === "menu" && form.menu.kind === "blank")
    return "signup-menu-first";
  if (field === "accent" && form.accent === null) return "signup-accent-custom";
  return FOCUS[field];
}

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/**
 * Step 1 of the owner's steps: the form. On a valid send it makes the
 * account (which sends the verification link) and hands the form over as a
 * draft; the cafe is written once the email is verified.
 */
export function SignupForm({
  data,
  user,
  draft,
  onSent,
}: {
  data: DataBundle;
  /** Already signed in: no account to make, so no email or password. */
  user: PlatformUser | null;
  draft: SignupDraft | null;
  onSent: (draft: SignupDraft) => void;
}) {
  const [form, setForm] = useState<Form>(() =>
    draft ? { ...draft.form, password: "" } : emptyForm(browserZone()),
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    existing: boolean;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Start on the visitor's likely country, unless they came back to a draft.
  useEffect(() => {
    if (draft) return;
    const guess = guessCountry(navigator.languages ?? [], browserZone());
    if (guess) {
      setForm((f) => (f.country ? f : settleMenu(f, withCountry(f, guess))));
    }
  }, [draft]);

  const update = (next: Form) => setForm((before) => settleMenu(before, next));

  const siteCheck = useSiteCheck(data.sites, form.site);
  const needsAccount = !user;
  const problems: FieldProblems = useMemo(() => {
    const found = formProblems(form, { needsAccount });
    if (!found.site && siteCheck?.status === "taken") found.site = "taken";
    return found;
  }, [form, needsAccount, siteCheck]);
  const shown: FieldProblems = submitted ? problems : {};
  const count = Object.keys(problems).length;

  // The first item of the menu as it will start, for the preview; or a
  // flat white at the starter price, where the currency has one.
  const sample = useMemo(() => {
    const settings = importSettingsOf(form);
    const first = menuOf(form).menu?.items[0];
    if (first) {
      return { name: first.name, price: formatMoney(first.price, settings) };
    }
    const price = starterPrice(FLAT_WHITE_CENTS, settings);
    return {
      name: signup.preview.item,
      price: price === null ? null : formatMoney(price, settings),
    };
  }, [form]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const first = firstProblem(problems);
    if (first) {
      document.getElementById(focusTarget(first, form))?.focus();
      return;
    }
    const email = user?.email ?? form.email.trim();
    setBusy(true);
    try {
      if (!user) await data.auth.signUp(email, form.password, continueUrl());
      onSent(draftOf(form, email));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      setFailure({
        message: errorText(error),
        existing: code === "auth/email-already-in-use",
      });
      setBusy(false);
    }
  };

  const signInInstead = async () => {
    setBusy(true);
    setFailure(null);
    const email = form.email.trim();
    try {
      await data.auth.signIn(email, form.password);
      onSent(draftOf(form, email));
    } catch (error) {
      setFailure({ message: errorText(error), existing: true });
      setBusy(false);
    }
  };

  const error = <K extends keyof FieldProblems>(field: K) => {
    const code = shown[field];
    if (!code) return undefined;
    return (problemText[field] as Record<string, string>)[code as string];
  };

  return (
    <form noValidate onSubmit={send} className="space-y-6">
      <FormSection id="signup-cafe" title={signup.sections.cafe}>
        <Field
          id="signup-name"
          label={signup.name.label}
          hint={signup.name.hint}
          error={error("name")}
        >
          <input
            type="text"
            value={form.name}
            onChange={(e) => update(withName(form, e.target.value))}
            autoComplete="organization"
            maxLength={80}
            {...controlProps("signup-name", {
              hint: true,
              error: error("name"),
            })}
            className={`${controlClass} min-h-tap`}
          />
        </Field>
        <SiteField
          site={form.site}
          cafeName={form.name}
          country={form.country}
          check={siteCheck}
          problem={shown.site}
          onSite={(site) => update(withSite(form, site))}
        />
        <Field
          id="signup-tables"
          label={signup.tables.label}
          hint={signup.tables.hint}
          error={error("tables")}
        >
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.tables}
            onChange={(e) => update({ ...form, tables: e.target.value })}
            maxLength={3}
            {...controlProps("signup-tables", {
              hint: true,
              error: error("tables"),
            })}
            className={`${controlClass} min-h-tap max-w-28`}
          />
        </Field>
      </FormSection>

      <FormSection id="signup-place" title={signup.sections.place}>
        <PlaceFields form={form} onChange={update} problems={shown} />
      </FormSection>

      <FormSection id="signup-look" title={signup.sections.look}>
        <LookFields
          form={form}
          onChange={update}
          problems={shown}
          item={sample}
        />
      </FormSection>

      <FormSection id="signup-menu-section" title={signup.sections.menu}>
        <MenuFields form={form} onChange={update} problems={shown} />
      </FormSection>

      <FormSection id="signup-account" title={signup.sections.account}>
        {user ? (
          <div>
            <p>
              <Rich
                text={fill(signup.account.signedIn, { email: user.email })}
              />
            </p>
            <TextButton onClick={() => data.auth.signOut()}>
              {signup.account.signOut}
            </TextButton>
          </div>
        ) : (
          <>
            <Field
              id="signup-email"
              label={signup.account.email}
              hint={signup.account.emailHint}
              error={error("email")}
            >
              <input
                type="email"
                value={form.email}
                onChange={(e) => update({ ...form, email: e.target.value })}
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                {...controlProps("signup-email", {
                  hint: true,
                  error: error("email"),
                })}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
            <Field
              id="signup-password"
              label={signup.account.password}
              hint={signup.account.passwordHint}
              error={error("password")}
            >
              <div className="flex gap-2">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) =>
                    update({ ...form, password: e.target.value })
                  }
                  autoComplete="new-password"
                  {...controlProps("signup-password", {
                    hint: true,
                    error: error("password"),
                  })}
                  className={`${controlClass} min-h-tap min-w-0 flex-1`}
                />
                <Button
                  variant="secondary"
                  aria-pressed={showPassword}
                  aria-controls="signup-password"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? signup.account.hide : signup.account.show}
                </Button>
              </div>
            </Field>
          </>
        )}
      </FormSection>

      <div className="space-y-3">
        {submitted && count > 0 && (
          <p role="alert" className="text-danger font-semibold">
            {count === 1 ? signup.fixField : fill(signup.fixFields, { count })}
          </p>
        )}
        {failure && (
          <div role="alert" className="bg-danger-soft rounded-md p-3">
            <p className="text-danger font-medium">{failure.message}</p>
            {failure.existing && form.password && (
              <TextButton onClick={signInInstead} disabled={busy}>
                {signup.account.signInInstead}
              </TextButton>
            )}
          </div>
        )}
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy
            ? signup.submitting
            : user
              ? signup.submitSignedIn
              : signup.submit}
        </Button>
        {!user && <p className="text-muted text-sm">{signup.afterSubmit}</p>}
      </div>
    </form>
  );
}

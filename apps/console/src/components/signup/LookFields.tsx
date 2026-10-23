"use client";

import { useState, type ChangeEvent } from "react";
import Image from "next/image";
import {
  THEMES,
  THEME_PRESETS,
  checkAccent,
  themePreset,
  type ThemeId,
} from "@cafemenu/shared";
import { toBase64 } from "@/lib/bytes";
import { fill, messages } from "@/lib/messages";
import type { FieldProblems, SignupForm } from "@/lib/signup/form";
import { logoHints } from "@/lib/signup/logo";
import { LogoError, storedLogo } from "@/lib/signup/logo-image";
import { TextButton } from "../Button";
import {
  Field,
  FieldGroup,
  FieldHint,
  controlClass,
  controlProps,
  describedBy,
} from "../form/Field";
import { FilePicker } from "../form/FilePicker";
import { ThemePreview } from "./ThemePreview";

const {
  theme: themeText,
  accent: accentText,
  logo: logoText,
} = messages.signup;
const problemText = messages.signup.problems.accent;

const HEX = /^#[0-9a-f]{6}$/i;

const logoUrl = (png: string) => `data:image/png;base64,${png}`;

/** Theme, accent colour and logo, with a live preview of all three. */
export function LookFields({
  form,
  onChange,
  problems,
  item,
}: {
  form: SignupForm;
  onChange: (form: SignupForm) => void;
  problems: FieldProblems;
  /** An item of the menu in the cafe's currency, for the preview. */
  item: { name: string; price: string | null };
}) {
  const [reading, setReading] = useState(false);
  const [logoProblem, setLogoProblem] = useState<string | null>(null);

  const pickTheme = (theme: ThemeId) => onChange({ ...form, theme });

  const onLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setLogoProblem(null);
    try {
      const logo = await storedLogo(file);
      onChange({
        ...form,
        logo: {
          png: toBase64(logo.png),
          width: logo.width,
          height: logo.height,
          original: logo.original,
        },
      });
    } catch (error) {
      const problem = error instanceof LogoError ? error.problem : "unreadable";
      setLogoProblem(logoText.problems[problem]);
    } finally {
      setReading(false);
    }
  };

  const hints = form.logo ? logoHints(form.logo.original) : [];

  return (
    <>
      <FieldGroup id="signup-theme" legend={themeText.label}>
        <div className="grid gap-3 sm:grid-cols-2">
          {THEMES.map((id) => {
            const preset = THEME_PRESETS[id];
            const c = preset.colours;
            return (
              <label
                key={id}
                className="border-line-field has-checked:border-brand has-checked:bg-brand-soft has-focus-visible:outline-ring flex cursor-pointer gap-3 rounded-lg border p-3 has-checked:border-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-2"
              >
                <input
                  type="radio"
                  name="theme"
                  value={id}
                  checked={form.theme === id}
                  onChange={() => pickTheme(id)}
                  className="accent-brand mt-1 h-5 w-5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="text-ink block font-semibold">
                    {preset.name}
                  </span>
                  <span className="text-muted block text-sm">
                    {preset.description}
                  </span>
                  <span aria-hidden="true" className="mt-2 flex gap-1.5">
                    {[c.cream, c.paper, c.primary, c.ink].map((colour, i) => (
                      <span
                        key={i}
                        className="border-line-strong h-5 w-5 rounded-full border"
                        style={{ backgroundColor: colour }}
                      />
                    ))}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FieldGroup>

      <AccentField form={form} onChange={onChange} problem={problems.accent} />

      <Field
        id="signup-logo"
        label={logoText.label}
        hint={logoText.hint}
        error={logoProblem ?? undefined}
        optional
      >
        <div className="flex flex-wrap items-center gap-4">
          {form.logo && (
            <Image
              src={logoUrl(form.logo.png)}
              alt={logoText.alt}
              width={64}
              height={64}
              unoptimized
              className="border-line bg-surface h-16 w-16 rounded-md border object-contain"
            />
          )}
          <FilePicker
            id="signup-logo"
            label={form.logo ? logoText.change : logoText.choose}
            accept="image/png,image/jpeg,image/webp"
            onChange={onLogo}
            disabled={reading}
            describedBy={describedBy("signup-logo", {
              hint: logoText.hint,
              error: logoProblem,
            })}
            invalid={logoProblem !== null}
          />
          {form.logo && (
            <TextButton onClick={() => onChange({ ...form, logo: null })}>
              {logoText.remove}
            </TextButton>
          )}
        </div>
        <div aria-live="polite" className="text-muted mt-2 space-y-1 text-sm">
          {reading && <p>{logoText.reading}</p>}
          {form.logo && !reading && (
            <>
              <p>
                {fill(logoText.stored, {
                  width: form.logo.width,
                  height: form.logo.height,
                })}
              </p>
              {hints.map((hint) => (
                <p key={hint}>{logoText[hint]}</p>
              ))}
              <p>{logoText.where}</p>
            </>
          )}
        </div>
      </Field>

      <ThemePreview
        theme={form.theme}
        accent={form.accent && HEX.test(form.accent) ? form.accent : null}
        name={form.name}
        logo={form.logo ? logoUrl(form.logo.png) : null}
        item={item}
      />
    </>
  );
}

/**
 * The theme's own accent, or the owner's, checked as it is typed with the
 * shared contrast guard (#10). A colour that fails offers the nearest one
 * that passes.
 */
function AccentField({
  form,
  onChange,
  problem,
}: {
  form: SignupForm;
  onChange: (form: SignupForm) => void;
  problem: FieldProblems["accent"];
}) {
  const preset = themePreset(form.theme);
  const custom = form.accent !== null;
  const text = form.accent ?? "";
  const valid = HEX.test(text);
  const check = valid ? checkAccent(form.theme, text) : null;
  const error = problem ? problemText[problem] : undefined;
  const setAccent = (accent: string | null) => onChange({ ...form, accent });

  return (
    <FieldGroup id="signup-accent" legend={accentText.label} error={error}>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="min-h-tap flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="accent"
            checked={!custom}
            onChange={() => setAccent(null)}
            className="accent-brand h-5 w-5"
          />
          <span>{accentText.own}</span>
        </label>
        <label className="min-h-tap flex cursor-pointer items-center gap-2">
          <input
            id="signup-accent-custom"
            type="radio"
            name="accent"
            checked={custom}
            onChange={() => setAccent(preset.colours.primary)}
            className="accent-brand h-5 w-5"
          />
          <span>{accentText.custom}</span>
        </label>
      </div>
      {custom && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="signup-accent-picker"
                className="text-ink block text-sm font-semibold"
              >
                {accentText.picker}
              </label>
              <input
                id="signup-accent-picker"
                type="color"
                value={valid ? text.toLowerCase() : preset.colours.primary}
                onChange={(e) => setAccent(e.target.value.toUpperCase())}
                className="border-line-field bg-surface min-h-tap mt-1 block w-20 cursor-pointer rounded-md border p-1"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label
                htmlFor="signup-accent-hex"
                className="text-ink block text-sm font-semibold"
              >
                {accentText.hex}
              </label>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                value={text}
                onChange={(e) => setAccent(e.target.value.trim())}
                {...controlProps("signup-accent-hex", {
                  hint: true,
                  error,
                })}
                className={`${controlClass} min-h-tap mt-1 max-w-40 font-mono`}
              />
              <FieldHint id="signup-accent-hex" text={accentText.hexHint} />
            </div>
          </div>
          <div aria-live="polite" className="text-sm">
            {check?.ok && (
              <p className="text-brand-ink font-medium">
                {fill(accentText.passes, { ratio: check.contrast.toFixed(1) })}
              </p>
            )}
            {check && !check.ok && (
              <div className="bg-danger-soft rounded-md p-3">
                <p className="text-danger font-medium">
                  {fill(
                    preset.scheme === "dark"
                      ? accentText.failsDark
                      : accentText.fails,
                    { ratio: check.contrast.toFixed(1) },
                  )}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="border-line-strong h-6 w-6 shrink-0 rounded-full border"
                    style={{ backgroundColor: check.suggestion }}
                  />
                  <TextButton onClick={() => setAccent(check.suggestion)}>
                    {fill(accentText.useSuggested, {
                      colour: check.suggestion,
                    })}
                  </TextButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </FieldGroup>
  );
}

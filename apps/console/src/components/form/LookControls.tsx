"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
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
import type { FormLogo } from "@/lib/signup/form";
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
} from "./Field";
import { FilePicker } from "./FilePicker";

/**
 * The theme, accent colour and logo controls, shared by the sign-up form and
 * the owner area's Branding section. `idPrefix` keeps their ids apart ("signup",
 * "brand") and names the radio groups.
 */

const {
  theme: themeText,
  accent: accentText,
  logo: logoText,
} = messages.signup;
const accentProblems = messages.signup.problems.accent;

const HEX = /^#[0-9a-f]{6}$/i;

export const logoUrl = (png: string) => `data:image/png;base64,${png}`;

export function ThemePicker({
  idPrefix,
  theme,
  onChange,
}: {
  idPrefix: string;
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}) {
  return (
    <FieldGroup id={`${idPrefix}-theme`} legend={themeText.label}>
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
                name={`${idPrefix}-theme`}
                value={id}
                checked={theme === id}
                onChange={() => onChange(id)}
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
  );
}

/**
 * The theme's own accent, or the owner's, checked as it is typed with the
 * shared contrast guard (#10). A colour that fails offers the nearest one
 * that passes.
 */
export function AccentPicker({
  idPrefix,
  theme,
  accent,
  onChange,
  problem,
}: {
  idPrefix: string;
  theme: ThemeId;
  /** "#RRGGBB" as typed, or null for the theme's own. */
  accent: string | null;
  onChange: (accent: string | null) => void;
  problem?: "invalid" | "contrast";
}) {
  const preset = themePreset(theme);
  const custom = accent !== null;
  const text = accent ?? "";
  const valid = HEX.test(text);
  const check = valid ? checkAccent(theme, text) : null;
  const error = problem ? accentProblems[problem] : undefined;
  const id = `${idPrefix}-accent`;

  return (
    <FieldGroup id={id} legend={accentText.label} error={error}>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="min-h-tap flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={id}
            checked={!custom}
            onChange={() => onChange(null)}
            className="accent-brand h-5 w-5"
          />
          <span>{accentText.own}</span>
        </label>
        <label className="min-h-tap flex cursor-pointer items-center gap-2">
          <input
            id={`${id}-custom`}
            type="radio"
            name={id}
            checked={custom}
            onChange={() => onChange(preset.colours.primary)}
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
                htmlFor={`${id}-picker`}
                className="text-ink block text-sm font-semibold"
              >
                {accentText.picker}
              </label>
              <input
                id={`${id}-picker`}
                type="color"
                value={valid ? text.toLowerCase() : preset.colours.primary}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="border-line-field bg-surface min-h-tap mt-1 block w-20 cursor-pointer rounded-md border p-1"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`${id}-hex`}
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
                onChange={(e) => onChange(e.target.value.trim())}
                {...controlProps(`${id}-hex`, { hint: true, error })}
                className={`${controlClass} min-h-tap mt-1 max-w-40 font-mono`}
              />
              <FieldHint id={`${id}-hex`} text={accentText.hexHint} />
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
                  <TextButton onClick={() => onChange(check.suggestion)}>
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

/**
 * Chooses a logo file and shrinks it to the stored PNG. `where` says what
 * becomes of it (it differs before and after the cafe's site exists), and
 * `children` is anything more to say under the picker.
 */
export function LogoPicker({
  idPrefix,
  logo,
  onChange,
  where = logoText.where,
  children,
}: {
  idPrefix: string;
  logo: FormLogo | null;
  onChange: (logo: FormLogo | null) => void;
  where?: string;
  children?: ReactNode;
}) {
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `${idPrefix}-logo`;

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setProblem(null);
    try {
      const stored = await storedLogo(file);
      onChange({
        png: toBase64(stored.png),
        width: stored.width,
        height: stored.height,
        original: stored.original,
      });
    } catch (error) {
      const code = error instanceof LogoError ? error.problem : "unreadable";
      setProblem(logoText.problems[code]);
    } finally {
      setReading(false);
    }
  };

  const hints = logo ? logoHints(logo.original) : [];

  return (
    <Field
      id={id}
      label={logoText.label}
      hint={logoText.hint}
      error={problem ?? undefined}
      optional
    >
      <div className="flex flex-wrap items-center gap-4">
        {logo && (
          <Image
            src={logoUrl(logo.png)}
            alt={logoText.alt}
            width={64}
            height={64}
            unoptimized
            className="border-line bg-surface h-16 w-16 rounded-md border object-contain"
          />
        )}
        <FilePicker
          id={id}
          label={logo ? logoText.change : logoText.choose}
          accept="image/png,image/jpeg,image/webp"
          onChange={onFile}
          disabled={reading}
          describedBy={describedBy(id, { hint: logoText.hint, error: problem })}
          invalid={problem !== null}
        />
        {logo && (
          <TextButton onClick={() => onChange(null)}>
            {logoText.remove}
          </TextButton>
        )}
      </div>
      <div aria-live="polite" className="text-muted mt-2 space-y-1 text-sm">
        {reading && <p>{logoText.reading}</p>}
        {logo && !reading && (
          <>
            <p>
              {fill(logoText.stored, {
                width: logo.width,
                height: logo.height,
              })}
            </p>
            {hints.map((hint) => (
              <p key={hint}>{logoText[hint]}</p>
            ))}
            <p>{where}</p>
          </>
        )}
      </div>
      {children}
    </Field>
  );
}

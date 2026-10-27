"use client";

import type { FieldProblems, SignupForm } from "@/lib/signup/form";
import {
  AccentPicker,
  LogoPicker,
  ThemePicker,
  logoUrl,
} from "../form/LookControls";
import { ThemePreview } from "./ThemePreview";

const HEX = /^#[0-9a-f]{6}$/i;

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
  return (
    <>
      <ThemePicker
        idPrefix="signup"
        theme={form.theme}
        onChange={(theme) => onChange({ ...form, theme })}
      />

      <AccentPicker
        idPrefix="signup"
        theme={form.theme}
        accent={form.accent}
        onChange={(accent) => onChange({ ...form, accent })}
        problem={problems.accent}
      />

      <LogoPicker
        idPrefix="signup"
        logo={form.logo}
        onChange={(logo) => onChange({ ...form, logo })}
      />

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

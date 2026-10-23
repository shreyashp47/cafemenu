import type { ReactNode } from "react";
import { messages } from "@/lib/messages";
import { Rich } from "../Rich";

/** The look of a text field, select or textarea: one edge, one focus ring. */
export const controlClass =
  "border-line-field bg-surface text-ink aria-invalid:border-danger block w-full rounded-md border px-3 text-base aria-invalid:border-2";

/** Ids of what describes a control: its problem first, then its hint. */
export function describedBy(
  id: string,
  { hint, error }: { hint?: unknown; error?: unknown },
): string | undefined {
  const ids = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""];
  return ids.filter(Boolean).join(" ") || undefined;
}

/** The attributes a control needs to be named, described and flagged. */
export function controlProps(
  id: string,
  { hint, error }: { hint?: unknown; error?: unknown },
) {
  return {
    id,
    "aria-describedby": describedBy(id, { hint, error }),
    "aria-invalid": error ? true : undefined,
  } as const;
}

export function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={`${id}-error`} className="text-danger mt-2 text-sm font-medium">
      {text}
    </p>
  );
}

export function FieldHint({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={`${id}-hint`} className="text-muted mt-1 text-sm">
      <Rich text={text} />
    </p>
  );
}

/**
 * A labelled control with its hint and its problem. Pass the control the
 * same `id` and controlProps(), so it is named by the label and described
 * by the rest.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink block font-semibold">
        {label}
        {optional && (
          <span className="text-muted font-normal">
            {" "}
            ({messages.signup.optional})
          </span>
        )}
      </label>
      <FieldHint id={id} text={hint} />
      <div className="mt-2">{children}</div>
      <FieldError id={id} text={error} />
    </div>
  );
}

/** A group of radios or related controls, named by its legend. */
export function FieldGroup({
  id,
  legend,
  hint,
  error,
  children,
}: {
  id: string;
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset aria-describedby={describedBy(id, { hint, error })}>
      <legend className="text-ink font-semibold">{legend}</legend>
      <FieldHint id={id} text={hint} />
      <div className="mt-3">{children}</div>
      <FieldError id={id} text={error} />
    </fieldset>
  );
}

/** One card of the form, with its own heading. */
export function FormSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-line bg-surface shadow-card rounded-xl border p-5 sm:p-7"
    >
      <h2
        id={`${id}-title`}
        className="font-display text-ink text-xl leading-tight tracking-tight sm:text-2xl"
      >
        {title}
      </h2>
      <div className="mt-5 space-y-6">{children}</div>
    </section>
  );
}

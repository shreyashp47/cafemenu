import type { ChangeEvent } from "react";
import { buttonClass, type Variant } from "../ButtonLink";

/**
 * A file input shown as a button with words of our own, instead of the
 * browser's "No file chosen", which stays put even once a file is in use.
 * The input itself is still there for keyboards and screen readers, only
 * visually hidden; the button shows its focus.
 */
export function FilePicker({
  id,
  label,
  accept,
  onChange,
  disabled = false,
  describedBy,
  invalid = false,
  variant = "secondary",
}: {
  id: string;
  label: string;
  accept: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
  variant?: Variant;
}) {
  return (
    <span className="inline-flex">
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={`${buttonClass(variant)} peer-focus-visible:outline-ring cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-60`}
      >
        {label}
      </label>
    </span>
  );
}

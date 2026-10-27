import type { ComponentProps } from "react";
import { buttonClass, type Variant } from "./ButtonLink";

/** A <button> that looks like ButtonLink. Disabled ones fade. */
export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant)} disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

/** A quiet, underlined action inside text: "Sign out", "Start again". */
export function TextButton({
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={`text-brand-ink min-h-tap inline-flex items-center font-medium underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

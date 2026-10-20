import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "highlight" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-dark hover:bg-primary-soft active:bg-primary-dark shadow-card",
  // --secondary-deep, not --secondary: terracotta under cream text is 2.9:1
  secondary:
    "bg-secondary-deep text-on-dark hover:brightness-110 active:brightness-95 shadow-card",
  highlight:
    "bg-highlight text-ink hover:bg-highlight-soft active:brightness-95 shadow-card",
  ghost:
    "bg-paper/70 text-ink border-2 border-line hover:border-primary hover:bg-paper",
  danger: "bg-berry-deep text-on-dark hover:brightness-110 shadow-card",
};

const SIZES: Record<Size, string> = {
  // every size keeps the 44px minimum touch target (docs/anime-theme.md §4 ergonomics)
  sm: "min-h-11 px-3.5 text-sm gap-1.5",
  md: "min-h-11 px-5 text-base gap-2",
  lg: "min-h-13 px-6 text-lg gap-2.5",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "rounded-pill font-round inline-flex items-center justify-center font-semibold",
        "transition-[transform,background-color,filter] duration-150",
        "active:scale-[.97] disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;

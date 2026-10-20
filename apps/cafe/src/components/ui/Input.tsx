import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";

const base =
  "w-full rounded-sm border-2 border-line bg-paper px-3.5 text-ink " +
  "placeholder:text-muted/70 shadow-soft transition-colors " +
  "focus:border-primary focus:outline-none focus-visible:outline-3 " +
  "focus-visible:outline-ring focus-visible:outline-offset-0";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(base, "min-h-12", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(base, "min-h-24 py-2.5 leading-relaxed", className)}
      {...rest}
    />
  );
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        base,
        "min-h-12 appearance-none bg-[length:1rem] bg-[right_0.85rem_center] bg-no-repeat pr-10",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%237A3E1D'%3E%3Cpath fill-rule='evenodd' d='M5.2 7.5a1 1 0 011.4 0L10 10.8l3.4-3.3a1 1 0 111.4 1.4l-4.1 4a1 1 0 01-1.4 0l-4.1-4a1 1 0 010-1.4z' clip-rule='evenodd'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-ink text-sm font-semibold tracking-wide"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-berry-deep text-sm font-semibold">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted text-sm">{hint}</p>
      ) : null}
    </div>
  );
}

export default Input;

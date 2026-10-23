import type { ReactNode } from "react";

/** The panel each step of the flow sits in. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="border-line bg-surface shadow-card space-y-5 rounded-xl border p-5 sm:p-8">
      {children}
    </div>
  );
}

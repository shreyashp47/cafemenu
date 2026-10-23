import { Words } from "./Words";

/**
 * Where a screenshot of Google's console goes once the Phase 0 spike (#3)
 * has taken it: until then, the marked placeholder saying which.
 */
export function ShotPlaceholder({ text }: { text: string }) {
  return (
    <figure className="border-line-field bg-sunk text-muted rounded-lg border-2 border-dashed p-4 text-sm">
      <figcaption>
        <Words text={text} />
      </figcaption>
    </figure>
  );
}

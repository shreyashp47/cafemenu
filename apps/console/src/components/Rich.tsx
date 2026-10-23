import { parseRich } from "@/lib/messages";

/**
 * A message with its inline markup (see src/lib/messages.ts) as elements.
 * Text is always rendered as text, never as HTML.
 *
 * With `newTab` (the words a screen reader hears for it), links to other
 * sites open in a new tab: the setup steps send owners to Google's consoles
 * and need them to come back to the same page.
 */
export function Rich({ text, newTab }: { text: string; newTab?: string }) {
  return (
    <>
      {parseRich(text).map((part, i) => {
        switch (part.kind) {
          case "strong":
            return (
              <strong key={i} className="text-ink font-semibold">
                {part.text}
              </strong>
            );
          case "code":
            return (
              <code
                key={i}
                className="bg-sunk text-ink rounded-sm px-1.5 py-0.5 font-mono text-[0.9em]"
              >
                {part.text}
              </code>
            );
          case "link": {
            const away =
              newTab !== undefined && part.href.startsWith("https://");
            return (
              <a
                key={i}
                href={part.href}
                {...(away
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="text-brand-ink font-medium underline decoration-1 underline-offset-2 hover:decoration-2"
              >
                {part.text}
                {away && <span className="sr-only"> {newTab}</span>}
              </a>
            );
          }
          default:
            return part.text;
        }
      })}
    </>
  );
}

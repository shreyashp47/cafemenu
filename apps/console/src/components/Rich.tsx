import { parseRich } from "@/lib/messages";

/**
 * A message with its inline markup (see src/lib/messages.ts) as elements.
 * Text is always rendered as text, never as HTML.
 */
export function Rich({ text }: { text: string }) {
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
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                className="text-brand-ink font-medium underline decoration-1 underline-offset-2 hover:decoration-2"
              >
                {part.text}
              </a>
            );
          default:
            return part.text;
        }
      })}
    </>
  );
}

import { messages } from "@/lib/messages";
import { parseNotes } from "@/lib/notes";
import { Rich } from "../Rich";

const { notes: text } = messages.cafe.updates;

/**
 * A release's notes: headings, paragraphs and bullets of the Markdown the
 * maintainer wrote (src/lib/notes.ts), as text. Their headings are bold
 * lines, not headings, so they don't disturb the page's own outline.
 */
export function ReleaseNotes({ notes }: { notes: string }) {
  const blocks = parseNotes(notes);
  if (blocks.length === 0) return <p className="text-muted">{text.none}</p>;
  return (
    <div className="text-text space-y-3">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p key={i} className="text-ink font-semibold">
                <Rich text={block.text} />
              </p>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={i}>
                <Rich text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

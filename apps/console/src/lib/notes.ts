/**
 * Release notes are Markdown (model.ts, `Release.notes`), written by the
 * maintainer and kept in the platform database. Only a small part of
 * Markdown is shown: headings, paragraphs and bullet lists, with the inline
 * **bold**, `code` and [links](https://…) that <Rich> renders. Anything else
 * reads as the text it is, and nothing is ever inserted as HTML.
 */

export type NoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;

/** Blocks of Markdown, in order. Empty or blank notes give no blocks. */
export function parseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const endParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const endList = () => {
    if (list) {
      blocks.push({ kind: "list", items: list });
      list = null;
    }
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line.trim());
    const bullet = BULLET.exec(line);
    if (!line.trim()) {
      endParagraph();
      endList();
    } else if (heading) {
      endParagraph();
      endList();
      blocks.push({ kind: "heading", text: heading[1] });
    } else if (bullet) {
      endParagraph();
      (list ??= []).push(bullet[1].trim());
    } else if (list && /^\s+\S/.test(line)) {
      // A bullet that carries on, indented, on the next line.
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  endList();
  return blocks;
}

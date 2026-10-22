import { Fragment, type ReactNode } from "react";

import { t, type MessageKey, type MessageParams } from "./i18n";

/**
 * A message with a little markup in it: <name>words</name> hands "words" to
 * `tags.name`, which wraps them. For the sentences that have a bold lead or a
 * code snippet in the middle, which would otherwise be cut into pieces that
 * no other language could put back in its own order. Tags do not nest.
 *
 *   rich("order.demoNotice", { strong: (c) => <strong>{c}</strong> })
 */
export function rich(
  key: MessageKey,
  tags: Record<string, (children: string) => ReactNode>,
  params?: MessageParams,
): ReactNode {
  const text = t(key, params);
  const parts: ReactNode[] = [];
  const tag = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(text))) {
    if (match.index > from) parts.push(text.slice(from, match.index));
    const wrap = tags[match[1]];
    parts.push(
      <Fragment key={match.index}>{wrap ? wrap(match[2]) : match[2]}</Fragment>,
    );
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

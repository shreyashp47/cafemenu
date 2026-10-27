import { messages } from "@/lib/messages";
import { Rich } from "../Rich";

/**
 * A setup message: links to Google's consoles open in a new tab, so the
 * owner comes back to the step they were on.
 */
export function Words({ text }: { text: string }) {
  return <Rich text={text} newTab={messages.setup.newTab} />;
}

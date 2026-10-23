import { messages } from "@/lib/messages";
import { Rich } from "./Rich";

/** Says plainly, in demo mode, that nothing typed is sent anywhere. */
export function DemoNotice({ text = messages.signup.demo }: { text?: string }) {
  return (
    <p className="border-line bg-accent-soft text-accent-ink rounded-md border px-4 py-3 text-sm">
      <Rich text={text} />
    </p>
  );
}

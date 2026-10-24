import { formatDate } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import type { SupportView } from "@/lib/owner/support";
import { Rich } from "../Rich";

const { support: text } = messages.cafe.updates;

/**
 * "Your version is no longer supported, upgrade by …": for a cafe that stays
 * on a minor line outside the support window (src/lib/owner/support.ts). The
 * date is the day in UTC, as the email says it, whatever the viewer's zone.
 */
export function SupportNotice({ view }: { view: SupportView }) {
  const date =
    view.upgradeBy === null ? null : formatDate(view.upgradeBy, "UTC");
  const left =
    view.daysLeft === 1
      ? text.dayLeft
      : fill(text.daysLeft, { count: view.daysLeft ?? 0 });
  return (
    <section
      aria-labelledby="support-title"
      className={`border-line space-y-2 rounded-lg border p-4 ${view.due ? "bg-danger-soft" : "bg-accent-soft"}`}
    >
      <h3 id="support-title" className="text-ink text-lg font-semibold">
        {fill(text.title, { line: view.line })}
      </h3>
      <p className="text-text">
        <Rich
          text={fill(text.text, {
            line: view.line,
            supported: view.supported.join(" and "),
          })}
        />
      </p>
      <p className="text-text">
        {date === null ? (
          text.noDate
        ) : (
          <Rich text={fill(view.due ? text.due : text.soon, { date, left })} />
        )}
      </p>
      <p className="text-text">
        <Rich
          text={
            view.target
              ? fill(text.action, { version: view.target })
              : text.noAction
          }
        />
      </p>
    </section>
  );
}

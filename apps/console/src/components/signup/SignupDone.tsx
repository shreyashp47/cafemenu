import { fill, messages } from "@/lib/messages";
import type { SavedCafe } from "@/lib/signup/flow";
import { StageHeading } from "./StageHeading";

const { done: text } = messages.signup;
const { names } = messages.locations;

/** The cafe is saved as a draft; what comes next. */
export function SignupDone({
  cafe,
  region,
  menuCount,
  focus,
}: {
  cafe: SavedCafe;
  region: string;
  /** Items on the starting menu; 0 for a blank one. */
  menuCount: number;
  focus: boolean;
}) {
  const place = names[region as keyof typeof names] ?? region;
  return (
    <div className="border-line bg-surface shadow-card space-y-5 rounded-xl border p-5 sm:p-8">
      <StageHeading
        eyebrow={text.eyebrow}
        title={fill(text.title, { name: cafe.settings.name })}
        focus={focus}
      />
      <p className="text-text text-lg">{text.text}</p>
      <dl className="divide-line border-line divide-y rounded-lg border">
        {[
          [text.address, `${cafe.site}.web.app`],
          [text.region, `${place} (${region})`],
          [
            text.menu,
            menuCount > 0
              ? fill(messages.signup.menu.items, { count: menuCount })
              : text.blank,
          ],
        ].map(([term, value]) => (
          <div key={term} className="flex flex-wrap justify-between gap-2 p-3">
            <dt className="text-muted">{term}</dt>
            <dd className="text-ink font-medium break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-text">{text.next}</p>
    </div>
  );
}

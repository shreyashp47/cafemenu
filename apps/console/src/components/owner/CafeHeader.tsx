import { dashboardUrl } from "@/lib/owner/area";
import { fill, messages } from "@/lib/messages";
import type { Cafe } from "@/lib/platform/model";
import { TextButton } from "../Button";
import { buttonClass } from "../ButtonLink";
import { Rich } from "../Rich";
import { StageHeading } from "../StageHeading";

const { header: text, nav, account } = messages.cafe;

/** A site exists to link to once the cafe has been set up. */
const HAS_SITE = ["live", "disconnected", "suspended"] as const;

const PILL: Record<Cafe["status"], string> = {
  draft: "bg-sunk text-ink",
  provisioning: "bg-accent-soft text-accent-ink",
  live: "bg-brand-soft text-brand-ink",
  failed: "bg-danger-soft text-danger",
  disconnected: "bg-danger-soft text-danger",
  suspended: "bg-danger-soft text-danger",
};

/**
 * The cafe's name and state, the link to its own dashboard (menu, tables,
 * orders and staff are managed there, in the owner's project), and where the
 * sections below are.
 */
export function CafeHeader({
  cafe,
  email,
  demo,
  onSignOut,
}: {
  cafe: Cafe;
  email: string;
  /** In demo mode there is no real site to open. */
  demo: boolean;
  onSignOut: () => void;
}) {
  const url = dashboardUrl(cafe.site);
  const note =
    cafe.status in text.notes
      ? text.notes[cafe.status as keyof typeof text.notes]
      : null;
  return (
    <div className="border-line bg-surface shadow-card space-y-5 rounded-xl border p-5 sm:p-8">
      <StageHeading
        eyebrow={text.eyebrow}
        title={cafe.settings.name}
        focus={false}
      />
      <p>
        <span className="sr-only">{text.statusLabel}: </span>
        <span
          className={`rounded-pill inline-block px-3 py-1 text-sm font-semibold ${PILL[cafe.status]}`}
        >
          {text.status[cafe.status]}
        </span>
      </p>
      {note && <p className="text-text">{note}</p>}

      {(HAS_SITE as readonly string[]).includes(cafe.status) && url && (
        <div className="border-line bg-sunk space-y-3 rounded-lg border p-4">
          <h2 className="text-ink text-lg font-semibold">
            {text.dashboard.title}
          </h2>
          <p className="text-text">{text.dashboard.text}</p>
          {demo ? (
            <p className="text-text">
              <Rich text={fill(text.dashboard.demo, { url })} />
            </p>
          ) : (
            <p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("primary")}
              >
                {text.dashboard.open}
                <span className="sr-only"> {messages.setup.newTab}</span>
              </a>
            </p>
          )}
          <p className="text-muted text-sm">
            <Rich text={fill(text.dashboard.site, { site: cafe.site })} />
          </p>
        </div>
      )}

      <nav aria-label={nav.label}>
        <ul className="flex flex-wrap gap-x-5">
          {(["updates", "branding", "access"] as const).map((id) => (
            <li key={id}>
              <a
                href={`#${id}-title`}
                className="text-brand-ink min-h-tap inline-flex items-center font-medium underline underline-offset-4"
              >
                {nav[id]}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <p className="text-muted flex flex-wrap items-center gap-x-3 text-sm">
        <span>
          <Rich text={fill(account.signedIn, { email })} />
        </span>
        <TextButton onClick={onSignOut}>{account.signOut}</TextButton>
      </p>
    </div>
  );
}

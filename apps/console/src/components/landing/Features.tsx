import { messages } from "@/lib/messages";
import { Phone } from "../Phone";
import { PaletteIcon, UpdateIcon } from "./icons";
import { Section } from "./Section";

const { features } = messages;
const EXTRA_ICONS = [PaletteIcon, UpdateIcon];

export function Features() {
  return (
    <Section
      id="features"
      title={features.title}
      lead={features.lead}
      tone="sunk"
    >
      <div className="space-y-16 sm:space-y-20">
        {features.groups.map((group) => (
          <article
            key={group.id}
            aria-labelledby={`features-${group.id}`}
            className="space-y-6"
          >
            <div className="max-w-2xl">
              <h3
                id={`features-${group.id}`}
                className="font-display text-ink text-2xl tracking-tight sm:text-3xl"
              >
                {group.title}
              </h3>
              <p className="text-text mt-3 text-lg">{group.text}</p>
            </div>
            {/*
              Where the screenshots do not fit (a phone, or the owner's three
              on a tablet) they scroll sideways inside this strip, never the
              page. Start-aligned: a centred row that overflows would push its
              first screenshot out of reach. It can take focus, so a keyboard
              can scroll it.
            */}
            <div
              role="region"
              aria-label={group.title}
              tabIndex={0}
              className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-2 pb-6 sm:mx-0 sm:gap-6 sm:px-0"
            >
              {group.shots.map((shot) => (
                <figure
                  key={shot.src}
                  className="shrink-0 snap-start"
                  style={{ width: `min(${shot.width}px, 62vw)` }}
                >
                  <Phone
                    src={shot.src}
                    alt={shot.alt}
                    width={shot.width}
                    height={shot.height}
                  />
                  <figcaption className="text-muted mt-3 text-center text-sm font-medium">
                    {shot.caption}
                  </figcaption>
                </figure>
              ))}
            </div>
          </article>
        ))}

        <ul className="grid gap-4 sm:grid-cols-2">
          {features.extras.map((extra, i) => {
            const Icon = EXTRA_ICONS[i] ?? PaletteIcon;
            return (
              <li
                key={extra.title}
                className="border-line bg-surface shadow-card rounded-lg border p-6"
              >
                <span className="bg-brand-soft text-brand-ink inline-flex size-10 items-center justify-center rounded-md">
                  <Icon />
                </span>
                <h3 className="text-ink mt-4 text-lg font-semibold">
                  {extra.title}
                </h3>
                <p className="text-text mt-1">{extra.text}</p>
              </li>
            );
          })}
        </ul>
        <p className="text-muted text-sm">{features.shotsNote}</p>
      </div>
    </Section>
  );
}

import { messages } from "@/lib/messages";
import { ButtonLink } from "../ButtonLink";
import { Phone } from "../Phone";
import { Rich } from "../Rich";
import { KeyIcon, LeafIcon, ScanIcon } from "./icons";

const { hero, points } = messages;
const POINT_ICONS = [ScanIcon, KeyIcon, LeafIcon];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      {/* A soft wash of the two brand tints behind the phones. */}
      <div
        aria-hidden="true"
        className="bg-brand-soft pointer-events-none absolute -top-24 right-[-30%] size-[34rem] rounded-full opacity-70 blur-3xl sm:right-[-10%]"
      />
      <div
        aria-hidden="true"
        className="bg-accent-soft pointer-events-none absolute top-64 right-[10%] size-[22rem] rounded-full opacity-80 blur-3xl"
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-8 lg:pb-24">
        <div>
          <p className="rounded-pill border-line bg-surface text-brand-ink inline-flex border px-3 py-1 text-sm font-medium">
            {hero.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="font-display text-ink mt-5 text-[2.375rem] leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]"
          >
            {hero.title}
          </h1>
          <p className="text-text mt-6 max-w-xl text-lg sm:text-xl">
            <Rich text={hero.lead} />
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup">{hero.primary}</ButtonLink>
            <ButtonLink href="#try" variant="secondary">
              {hero.secondary}
            </ButtonLink>
          </div>
          <p className="text-muted mt-5 text-sm">{hero.note}</p>
        </div>

        {/* Customer and staff, side by side, as the demo is used. */}
        <div className="flex items-start justify-center gap-3 sm:gap-5 lg:justify-end">
          <Phone
            src="/screens/01-order.png"
            alt={hero.shotCustomer}
            width={222}
            height={480}
            priority
            className="w-[42vw] max-w-[222px] -rotate-2"
          />
          <Phone
            src="/screens/04-staff-board.png"
            alt={hero.shotStaff}
            width={222}
            height={480}
            priority
            className="mt-10 w-[42vw] max-w-[222px] rotate-2"
          />
        </div>
      </div>

      <div className="border-line bg-surface relative border-y">
        <ul className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:px-6">
          {points.map((point, i) => {
            const Icon = POINT_ICONS[i] ?? ScanIcon;
            return (
              <li key={point.title} className="flex gap-3">
                <span className="bg-brand-soft text-brand-ink mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-md">
                  <Icon />
                </span>
                <span>
                  <span className="text-ink block font-semibold">
                    {point.title}
                  </span>
                  <span className="text-muted block text-[0.9375rem]">
                    {point.text}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

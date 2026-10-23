import Image from "next/image";
import { accentColours, monogramOf, themePreset } from "@cafemenu/shared";
import { messages } from "@/lib/messages";

const { preview } = messages.signup;

/**
 * A sliver of the cafe's menu in its theme: the header with the logo (or
 * initials) and name, and one item with its price and Add button. Colours
 * are the theme's own data from @cafemenu/shared, and the accent is the one
 * the cafe app would use: a colour that fails contrast is shown as the
 * shade the app moves it to, so what is previewed is what customers see.
 */
export function ThemePreview({
  theme,
  accent,
  name,
  logo,
  item,
}: {
  theme: string;
  accent: string | null;
  name: string;
  /** A data: URL of the stored PNG. */
  logo: string | null;
  /** One item of the menu, as customers would see it. */
  item: { name: string; price: string | null };
}) {
  const colours = themePreset(theme).colours;
  const primary = accentColours(theme, accent).primary;
  const title = name.trim() || preview.namePlaceholder;
  return (
    <figure aria-labelledby="signup-preview-label">
      <figcaption id="signup-preview-label" className="text-ink font-semibold">
        {preview.label}
      </figcaption>
      <div
        className="border-line mt-3 rounded-lg border p-4"
        style={{ backgroundColor: colours.cream, color: colours.body }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            <Image
              src={logo}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="h-10 w-10 shrink-0 rounded-md object-contain"
              style={{ backgroundColor: colours.paper }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold"
              style={{ backgroundColor: primary, color: colours["on-dark"] }}
            >
              {monogramOf(title)}
            </span>
          )}
          <span
            className="font-display min-w-0 truncate text-lg font-semibold"
            style={{ color: primary }}
          >
            {title}
          </span>
        </div>
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-md border p-3"
          style={{ backgroundColor: colours.paper, borderColor: colours.line }}
        >
          <div className="min-w-0">
            <p
              className="truncate font-semibold"
              style={{ color: colours.ink }}
            >
              {item.name}
            </p>
            {item.price && (
              <p className="text-sm font-semibold" style={{ color: primary }}>
                {item.price}
              </p>
            )}
          </div>
          <span
            aria-hidden="true"
            className="rounded-pill shrink-0 px-4 py-2 text-sm font-semibold"
            style={{ backgroundColor: primary, color: colours["on-dark"] }}
          >
            {preview.add}
          </span>
        </div>
      </div>
      {!logo && <p className="text-muted mt-2 text-sm">{preview.monogram}</p>}
    </figure>
  );
}

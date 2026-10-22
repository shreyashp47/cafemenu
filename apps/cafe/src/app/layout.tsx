import type { Metadata, Viewport } from "next";
import {
  Caveat,
  DM_Sans,
  DM_Serif_Display,
  Fredoka,
  Inter,
  Nunito,
  Outfit,
} from "next/font/google";
import { THEME_COLOURS } from "@cafemenu/shared";
import { CafeTheme, CafeTitle, DEFAULT_TITLE } from "@/components/CafeIdentity";
import { PwaRegister } from "@/components/Pwa";
import { t } from "@/lib/i18n";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

/**
 * Each theme's families, only the weights we actually use (docs/anime-theme.md
 * §6: "load only the weights used, to keep the page light for mobile data").
 * next/font self-hosts them, so there is no render-blocking Google request,
 * and a browser downloads a family only when the page's theme uses it.
 *
 * Cozy's three (TOE's) are preloaded, as TOE always did: Cozy is the default
 * and the demo. The other themes' are not, so a Cozy cafe never fetches them;
 * a cafe on another theme does still fetch Cozy's preloads, the price of one
 * build serving every cafe (docs/anime-theme.md §6).
 */
const display = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

const round = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const body = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

/** Minimal's only face, and Dark's body text. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});

/** Dark's headings. */
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  preload: false,
});

/** Bistro's headings and lettering, and its body face. */
const serif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
});

const sans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});

const FONT_VARIABLES = [display, round, body, inter, outfit, serif, sans]
  .map((font) => font.variable)
  .join(" ");

/**
 * Fixed at build time, and one build serves every cafe, so nothing here names
 * one. <CafeTitle> adds the cafe's name from its settings once they are known.
 */
export const metadata: Metadata = {
  title: { default: DEFAULT_TITLE, template: "%s" },
  description: t("meta.description"),
  appleWebApp: { capable: true, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // The default theme's; <CafeTheme> sets the cafe's own.
  themeColor: THEME_COLOURS.cozy.theme,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets data-theme and the accent on <html> before React
    // hydrates, hence suppressHydrationWarning (it covers this element only).
    // The font variables sit here too, where the theme tokens read them.
    <html lang="en" className={FONT_VARIABLES} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <PwaRegister />
        <CafeTitle />
        <CafeTheme />
        {children}
      </body>
    </html>
  );
}

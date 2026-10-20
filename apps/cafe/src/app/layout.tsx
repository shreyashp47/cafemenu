import type { Metadata, Viewport } from "next";
import { Caveat, Fredoka, Nunito } from "next/font/google";
import { CafeTitle, DEFAULT_TITLE } from "@/components/CafeIdentity";
import { PwaRegister } from "@/components/Pwa";
import "./globals.css";

/**
 * Exactly three families, only the weights we actually use (docs/anime-theme.md §6:
 * "load only the weights used, to keep the page light for mobile data").
 * next/font self-hosts them, so there is no render-blocking Google request.
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

/**
 * Fixed at build time, and one build serves every cafe, so nothing here names
 * one. <CafeTitle> adds the cafe's name from its settings once they are known.
 */
export const metadata: Metadata = {
  title: { default: DEFAULT_TITLE, template: "%s" },
  description:
    "Scan, order, and pay at the counter. Fresh brews and warm bites served straight to your table.",
  appleWebApp: { capable: true, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#7A3E1D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${round.variable} ${body.variable} antialiased`}
      >
        <PwaRegister />
        <CafeTitle />
        {children}
      </body>
    </html>
  );
}

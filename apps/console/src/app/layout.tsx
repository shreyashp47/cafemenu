import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import { messages } from "@/lib/messages";
import "./globals.css";

/**
 * One display face for headings, at one weight; body text uses the system
 * font, which costs nothing to load. next/font self-hosts it, so there is no
 * request to Google from the visitor's browser.
 */
const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

const { meta } = messages;

export const metadata: Metadata = {
  title: { default: meta.title, template: `%s · ${meta.name}` },
  description: meta.description,
  applicationName: meta.name,
  openGraph: {
    title: meta.title,
    description: meta.description,
    siteName: meta.name,
    type: "website",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#fbf8f3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={display.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}

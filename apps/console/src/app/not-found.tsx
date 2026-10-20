import type { Metadata } from "next";
import { ButtonLink } from "@/components/ButtonLink";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { messages } from "@/lib/messages";

const { notFound, meta } = messages;

export const metadata: Metadata = { title: meta.notFoundTitle };

export default function NotFound() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        <div className="mx-auto w-full max-w-2xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h1 className="font-display text-ink text-3xl tracking-tight sm:text-4xl">
            {notFound.title}
          </h1>
          <p className="text-text mt-4 text-lg">{notFound.text}</p>
          <div className="mt-8 flex justify-center">
            <ButtonLink href="/">{notFound.back}</ButtonLink>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

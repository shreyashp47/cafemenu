import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { REPO_URL } from "@/lib/config";
import { messages } from "@/lib/messages";

const { signup, meta } = messages;

export const metadata: Metadata = { title: meta.signupTitle };

/**
 * A placeholder until the sign-up form (#26) is built: says plainly that
 * sign-up is not open, and offers the demo and the project instead.
 */
export default function SignUp() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="border-line bg-surface shadow-card rounded-xl border p-7 sm:p-10">
            <p className="text-brand-ink text-sm font-semibold tracking-wide uppercase">
              {signup.eyebrow}
            </p>
            <h1 className="font-display text-ink mt-3 text-3xl leading-tight tracking-tight sm:text-4xl">
              {signup.title}
            </h1>
            <p className="text-text mt-4 text-lg">{signup.text}</p>
            <h2 className="text-ink mt-8 font-semibold">{signup.meanwhile}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <ButtonLink href="/#try">{signup.tryIt}</ButtonLink>
              <ButtonLink href={`${REPO_URL}/milestones`} variant="secondary">
                {signup.follow}
              </ButtonLink>
            </div>
            <p className="mt-8">
              <Link
                href="/"
                className="text-brand-ink font-medium underline underline-offset-4"
              >
                {signup.back}
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

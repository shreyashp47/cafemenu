import Link from "next/link";
import { REPO_URL } from "@/lib/config";
import { messages } from "@/lib/messages";
import { ButtonLink } from "./ButtonLink";

/** Says plainly that sign-up is not open, and offers the demo instead. */
export function SignupClosed() {
  const text = messages.signup.closed;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="border-line bg-surface shadow-card rounded-xl border p-7 sm:p-10">
        <p className="text-brand-ink text-sm font-semibold tracking-wide uppercase">
          {text.eyebrow}
        </p>
        <h1 className="font-display text-ink mt-3 text-3xl leading-tight tracking-tight sm:text-4xl">
          {text.title}
        </h1>
        <p className="text-text mt-4 text-lg">{text.text}</p>
        <h2 className="text-ink mt-8 font-semibold">{text.meanwhile}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/#try">{text.tryIt}</ButtonLink>
          <ButtonLink href={`${REPO_URL}/milestones`} variant="secondary">
            {text.follow}
          </ButtonLink>
        </div>
        <p className="mt-8">
          <Link
            href="/"
            className="text-brand-ink font-medium underline underline-offset-4"
          >
            {text.back}
          </Link>
        </p>
      </div>
    </div>
  );
}

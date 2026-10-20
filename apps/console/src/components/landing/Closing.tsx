import { REPO_URL } from "@/lib/config";
import { messages } from "@/lib/messages";
import { ButtonLink } from "../ButtonLink";

const { closing } = messages;

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="bg-brand">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2
          id="closing-title"
          className="font-display text-surface mx-auto max-w-2xl text-3xl leading-tight tracking-tight sm:text-4xl"
        >
          {closing.title}
        </h2>
        <p className="text-brand-soft mx-auto mt-4 max-w-xl text-lg">
          {closing.text}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/signup" variant="inverse">
            {closing.primary}
          </ButtonLink>
          <ButtonLink href={REPO_URL} variant="ghost-dark">
            {closing.secondary}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

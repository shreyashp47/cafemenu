"use client";

import { useEffect, useState } from "react";
import type { SiteAvailability, SiteNameChecker } from "@/lib/data/types";
import { fill, messages } from "@/lib/messages";
import type { FieldProblems } from "@/lib/signup/form";
import { siteNameProblem, siteSuggestions } from "@/lib/signup/site-name";
import { TextButton } from "../Button";
import {
  FieldError,
  FieldHint,
  controlClass,
  controlProps,
} from "../form/Field";

const { site: text } = messages.signup;
const problemText = messages.signup.problems.site;

export type SiteCheck =
  | { site: string; status: "checking" }
  | { site: string; status: SiteAvailability };

/** How long typing has to pause before a name is checked. */
const DEBOUNCE_MS = 400;

/**
 * Checks the name a moment after typing stops. Only a well-formed name is
 * sent, and only the answer for the name now in the field counts.
 */
export function useSiteCheck(
  checker: SiteNameChecker | null,
  site: string,
): SiteCheck | null {
  const [check, setCheck] = useState<SiteCheck | null>(null);
  useEffect(() => {
    if (!checker || siteNameProblem(site)) {
      setCheck(null);
      return;
    }
    let live = true;
    setCheck({ site, status: "checking" });
    const timer = setTimeout(() => {
      checker.check(site).then(
        (status) => live && setCheck({ site, status }),
        () => live && setCheck({ site, status: "unknown" }),
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [checker, site]);
  return check && check.site === site ? check : null;
}

/** The web address: the name, its check, and nearby names to use instead. */
export function SiteField({
  site,
  cafeName,
  country,
  check,
  problem,
  onSite,
}: {
  site: string;
  cafeName: string;
  country: string;
  check: SiteCheck | null;
  problem: FieldProblems["site"];
  onSite: (site: string) => void;
}) {
  const id = "signup-site";
  const error = problem ? problemText[problem] : undefined;
  const hint = fill(text.hint, {
    address: `${site || "your-cafe"}${text.suffix}`,
  });
  const offer =
    check?.status === "taken" ||
    (site !== "" && siteNameProblem(site) !== null);
  const suggestions = offer
    ? siteSuggestions(site || cafeName, { country }).slice(0, 3)
    : [];

  return (
    <div>
      <label htmlFor={id} className="text-ink block font-semibold">
        {text.label}
      </label>
      <FieldHint id={id} text={hint} />
      <div className="mt-2 flex items-stretch">
        <input
          type="text"
          value={site}
          onChange={(e) => onSite(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          maxLength={40}
          {...controlProps(id, { hint, error })}
          className={`${controlClass} min-h-tap min-w-0 rounded-r-none font-mono`}
        />
        <span
          aria-hidden="true"
          className="border-line-field bg-sunk text-muted flex items-center rounded-r-md border border-l-0 px-3 font-mono"
        >
          {text.suffix}
        </span>
      </div>
      <FieldError id={id} text={error} />
      <div aria-live="polite" className="mt-2 text-sm">
        {check?.status === "checking" && (
          <p className="text-muted">{text.checking}</p>
        )}
        {check?.status === "looks-free" && (
          <p className="text-brand-ink font-medium">{text.looksFree}</p>
        )}
        {check?.status === "taken" && !error && (
          <p className="text-danger font-medium">{text.taken}</p>
        )}
        {check?.status === "unknown" && (
          <p className="text-muted">{text.unknown}</p>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-ink text-sm font-semibold">{text.suggestions}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {suggestions.map((name) => (
              <li key={name}>
                <TextButton
                  onClick={() => onSite(name)}
                  aria-label={fill(text.use, { name })}
                  className="font-mono text-sm"
                >
                  {name}
                </TextButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted mt-2 text-sm">{text.final}</p>
    </div>
  );
}
